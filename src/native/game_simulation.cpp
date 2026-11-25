#include "game_simulation.hpp"

namespace serpentis {

WorldSimState g_sim;

struct SpeciesTraits {
  float speedMult;
  float turnMult;
  float staminaDrainMult;
};

static inline SpeciesTraits get_species_traits(int32_t species) {
  switch (species) {
    case SPECIES_GOLDEN:   return {1.07f, 1.04f, 1.0f};
    case SPECIES_OBSIDIAN: return {1.03f, 1.0f, 0.78f};
    case SPECIES_RATTLER:  return {1.02f, 1.12f, 0.92f};
    case SPECIES_CORAL:    return {1.1f, 1.1f, 1.08f};
    case SPECIES_ALBINO:   return {0.98f, 1.08f, 0.82f};
    case SPECIES_EMERALD:
    default:               return {1.0f, 1.05f, 0.9f};
  }
}

struct DifficultyParams {
  float speedMult;
  int32_t initialObs;
  int32_t maxObs;
  float hunterDmgMult;
  int32_t maxHunters;
};

static inline DifficultyParams get_diff_params(int32_t difficulty) {
  if (difficulty == DIFF_RELAXED) {
    return {0.85f, 24, 40, 0.7f, 16};
  }
  if (difficulty == DIFF_APEX) {
    return {1.2f, 38, 60, 1.35f, 26};
  }
  return {1.0f, 30, 50, 1.0f, 22};
}

static inline int32_t compute_power_tier(int32_t feasts) {
  if (feasts >= 10) return 4;
  if (feasts >= 6) return 3;
  if (feasts >= 3) return 2;
  return 1;
}

static int32_t nearest_village_id(float x, float z) {
  int32_t bestId = 0;
  float bestD2 = 1e12f;
  for (int32_t vi = 0; vi < NUM_VILLAGES; vi++) {
    float dx = x - g_villages[vi].centerX;
    float dz = z - g_villages[vi].centerZ;
    float d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestId = vi;
    }
  }
  return bestId;
}

static inline void push_event(
    int32_t type,
    int32_t a,
    int32_t b,
    int32_t c,
    float x,
    float y,
    float z,
    float f0,
    float f1) {
  if (g_sim.eventCount >= MAX_EVENT_POOL) return;
  SimEvent& ev = g_sim.events[g_sim.eventCount++];
  ev.type = type;
  ev.a = a;
  ev.b = b;
  ev.c = c;
  ev.x = x;
  ev.y = y;
  ev.z = z;
  ev.f0 = f0;
  ev.f1 = f1;
  ev.pad0 = ev.pad1 = ev.pad2 = 0.0f;
}

static inline int32_t get_village_threat_level() {
  float h = g_sim.scalars.raidHeat;
  if (h < 3.0f) return 1;
  if (h < 7.0f) return 2;
  if (h < 13.0f) return 3;
  if (h < 20.0f) return 4;
  return 5 + static_cast<int32_t>(c_floorf((h - 20.0f) / 8.0f));
}

static bool has_strike_cd(int32_t vid) {
  for (int32_t i = 0; i < g_sim.strikeCdCount; i++) {
    if (g_sim.strikeCdIds[i] == vid) return true;
  }
  return false;
}

static void set_strike_cd(int32_t vid, float cd) {
  for (int32_t i = 0; i < g_sim.strikeCdCount; i++) {
    if (g_sim.strikeCdIds[i] == vid) {
      g_sim.strikeCdTimers[i] = cd;
      return;
    }
  }
  if (g_sim.strikeCdCount < MAX_VILLAGER_POOL) {
    int32_t idx = g_sim.strikeCdCount++;
    g_sim.strikeCdIds[idx] = vid;
    g_sim.strikeCdTimers[idx] = cd;
  }
}

static void tick_strike_cds(float dt) {
  for (int32_t i = g_sim.strikeCdCount - 1; i >= 0; i--) {
    g_sim.strikeCdTimers[i] -= dt;
    if (g_sim.strikeCdTimers[i] <= 0.0f) {
      int32_t last = --g_sim.strikeCdCount;
      g_sim.strikeCdIds[i] = g_sim.strikeCdIds[last];
      g_sim.strikeCdTimers[i] = g_sim.strikeCdTimers[last];
    }
  }
}

static inline float* spine_at(int32_t logicalIdx) {
  int32_t ringIdx = (g_sim.spineHeadIdx + logicalIdx) & 2047;
  return &g_sim.playerSpineRing[ringIdx * 4];
}

static void push_player_spine_point(float x, float y, float z, float dist) {
  if (g_sim.scalars.spineLen > 0) {
    float* first = spine_at(0);
    if (dist - first[3] < 0.08f) {
      first[0] = x;
      first[1] = y;
      first[2] = z;
      first[3] = dist;
      return;
    }
  }
  g_sim.spineHeadIdx = (g_sim.spineHeadIdx - 1) & 2047;
  float* p = spine_at(0);
  p[0] = x;
  p[1] = y;
  p[2] = z;
  p[3] = dist;
  if (g_sim.scalars.spineLen < 2048) {
    g_sim.scalars.spineLen++;
  }
  float maxKeep = static_cast<float>(MAX_SEGMENTS + 12) * SEGMENT_SPACING * MAX_SNAKE_SCALE;
  while (g_sim.scalars.spineLen > 2) {
    float* tail = spine_at(g_sim.scalars.spineLen - 1);
    if (g_sim.scalars.totalDist - tail[3] > maxKeep) {
      g_sim.scalars.spineLen--;
    } else {
      break;
    }
  }
}

static void sample_generic_spine(
    const float* ringBuf,
    int32_t headIdx,
    int32_t mask,
    int32_t spineLen,
    float headTotalDist,
    float distBehind,
    float& outX,
    float& outY,
    float& outZ,
    float& outYaw) {
  if (spineLen <= 0) {
    outX = outY = outZ = outYaw = 0.0f;
    return;
  }
  float targetDist = c_fmaxf(0.0f, headTotalDist - distBehind);
  const float* p0 = &ringBuf[((headIdx) & mask) * 4];
  if (spineLen == 1 || targetDist >= p0[3]) {
    const float* p1 = spineLen > 1 ? &ringBuf[((headIdx + 1) & mask) * 4] : p0;
    outX = p0[0];
    outY = p0[1];
    outZ = p0[2];
    outYaw = c_atan2f(p0[0] - p1[0], p0[2] - p1[2]);
    return;
  }

  for (int32_t i = 0; i < spineLen - 1; i++) {
    const float* newer = &ringBuf[((headIdx + i) & mask) * 4];
    const float* older = &ringBuf[((headIdx + i + 1) & mask) * 4];
    if (targetDist <= newer[3] && targetDist >= older[3]) {
      float span = newer[3] - older[3];
      float t = span > 1e-6f ? (targetDist - older[3]) / span : 0.0f;
      outX = older[0] + (newer[0] - older[0]) * t;
      outY = older[1] + (newer[1] - older[1]) * t;
      outZ = older[2] + (newer[2] - older[2]) * t;
      outYaw = c_atan2f(newer[0] - older[0], newer[2] - older[2]);
      return;
    }
  }

  const float* tail = &ringBuf[((headIdx + spineLen - 1) & mask) * 4];
  const float* prev = spineLen > 1 ? &ringBuf[((headIdx + spineLen - 2) & mask) * 4] : tail;
  outX = tail[0];
  outY = tail[1];
  outZ = tail[2];
  outYaw = c_atan2f(prev[0] - tail[0], prev[2] - tail[2]);
}

// Oriented capsule collision against fallen logs (obs.kind == 1)
static bool resolve_log_capsule(
    const ObstacleSlot& obs,
    float& px,
    float& pz,
    float py,
    float rad,
    float& outNormX,
    float& outNormZ) {
  float obsY = ground_height_at(obs.x, obs.z);
  if (py > obsY + 1.45f * obs.scale) return false;

  float c = c_cosf(obs.rotation);
  float s = c_sinf(obs.rotation);
  float halfLen = 1.12f * obs.scale;
  float ax = obs.x - c * halfLen;
  float az = obs.z + s * halfLen;
  float bx = obs.x + c * halfLen;
  float bz = obs.z - s * halfLen;

  float abx = bx - ax;
  float abz = bz - az;
  float abLen2 = abx * abx + abz * abz;
  float t = abLen2 > 1e-6f ? c_clampf(((px - ax) * abx + (pz - az) * abz) / abLen2, 0.0f, 1.0f) : 0.0f;
  float cx = ax + t * abx;
  float cz = az + t * abz;

  float dx = px - cx;
  float dz = pz - cz;
  float d2 = dx * dx + dz * dz;
  float minD = rad + 0.54f * obs.scale;
  if (d2 < minD * minD) {
    float d = c_sqrtf(d2);
    float nx = d > 1e-4f ? dx / d : s;
    float nz = d > 1e-4f ? dz / d : c;
    px = cx + nx * minD;
    pz = cz + nz * minD;
    outNormX += nx;
    outNormZ += nz;
    return true;
  }
  return false;
}

// Universal solid obstacle + wall + fence + well + tree + arena push-out
static bool resolve_solid_point(
    float& px,
    float& pz,
    float py,
    float rad,
    float& outNormX,
    float& outNormZ) {
  bool hit = false;
  outNormX = 0.0f;
  outNormZ = 0.0f;

  CollisionResult wallHit = resolve_building_wall_collision(px, py, pz, rad);
  if (wallHit.collided) {
    px = wallHit.x;
    pz = wallHit.z;
    outNormX += wallHit.normalX;
    outNormZ += wallHit.normalZ;
    hit = true;
  }

  CollisionResult fenceHit = resolve_world_walls_collision(px, py, pz, rad);
  if (fenceHit.collided) {
    px = fenceHit.x;
    pz = fenceHit.z;
    outNormX += fenceHit.normalX;
    outNormZ += fenceHit.normalZ;
    hit = true;
  }

  for (int32_t oi = 0; oi < g_sim.obstacleCount; oi++) {
    const ObstacleSlot& obs = g_sim.obstacles[oi];
    if (obs.kind == 1) {
      if (resolve_log_capsule(obs, px, pz, py, rad, outNormX, outNormZ)) {
        hit = true;
      }
    } else {
      float dx = px - obs.x;
      float dz = pz - obs.z;
      float d2 = dx * dx + dz * dz;
      float minD = rad + obs.radius * 0.92f;
      if (d2 < minD * minD) {
        float obsY = ground_height_at(obs.x, obs.z);
        if (py < obsY + 2.15f * obs.scale) {
          float d = c_sqrtf(d2);
          float nx = d > 1e-4f ? dx / d : 1.0f;
          float nz = d > 1e-4f ? dz / d : 0.0f;
          px = obs.x + nx * minD;
          pz = obs.z + nz * minD;
          outNormX += nx;
          outNormZ += nz;
          hit = true;
        }
      }
    }
  }

  for (int32_t ti = 0; ti < g_sim.treeCount; ti++) {
    const TreeSlot& tr = g_sim.trees[ti];
    float dx = px - tr.x;
    float dz = pz - tr.z;
    float d2 = dx * dx + dz * dz;
    float minD = rad + tr.radius;
    if (d2 < minD * minD) {
      float d = c_sqrtf(d2);
      float nx = d > 1e-4f ? dx / d : 1.0f;
      float nz = d > 1e-4f ? dz / d : 0.0f;
      px = tr.x + nx * minD;
      pz = tr.z + nz * minD;
      outNormX += nx;
      outNormZ += nz;
      hit = true;
    }
  }

  float maxR = ARENA_RADIUS - rad * 1.1f;
  float rPos = c_hypotf(px, pz);
  if (rPos > maxR && rPos > 1e-4f) {
    float nx = -px / rPos;
    float nz = -pz / rPos;
    px = (px / rPos) * maxR;
    pz = (pz / rPos) * maxR;
    outNormX += nx;
    outNormZ += nz;
    hit = true;
  }

  float nLen = c_hypotf(outNormX, outNormZ);
  if (nLen > 1e-6f) {
    outNormX /= nLen;
    outNormZ /= nLen;
  }
  return hit;
}

void sim_compute_segment_poses() {
  int32_t segCount = g_sim.scalars.segmentCount;
  if (segCount <= 0) return;
  if (segCount > MAX_SEGMENTS) segCount = MAX_SEGMENTS;
  int32_t spineLen = g_sim.scalars.spineLen;
  if (spineLen <= 0) return;

  float sc = c_clampf(g_sim.scalars.snakeScale, START_SNAKE_SCALE, MAX_SNAKE_SCALE);
  float effSpacing = SEGMENT_SPACING * sc;
  float growthThickBonus =
      1.0f + c_fminf(0.24f, static_cast<float>(segCount - INITIAL_SEGMENTS) /
                                static_cast<float>(MAX_SEGMENTS - INITIAL_SEGMENTS) * 0.24f);

  float headTotalDist = g_sim.scalars.totalDist;
  int32_t cursor = 0;
  for (int32_t i = 0; i < segCount; i++) {
    float distBehind = static_cast<float>(i + 1) * effSpacing;
    float targetDist = c_fmaxf(0.0f, headTotalDist - distBehind);

    float sx = 0.0f, sy = 0.0f, sz = 0.0f, syaw = 0.0f;
    const float* p0 = spine_at(0);
    if (spineLen == 1 || targetDist >= p0[3]) {
      const float* p1 = spineLen > 1 ? spine_at(1) : p0;
      sx = p0[0];
      sy = p0[1];
      sz = p0[2];
      syaw = c_atan2f(p0[0] - p1[0], p0[2] - p1[2]);
    } else {
      bool found = false;
      while (cursor < spineLen - 1) {
        const float* newer = spine_at(cursor);
        const float* older = spine_at(cursor + 1);
        if (targetDist <= newer[3] && targetDist >= older[3]) {
          float span = newer[3] - older[3];
          float t = span > 1e-6f ? (targetDist - older[3]) / span : 0.0f;
          sx = older[0] + (newer[0] - older[0]) * t;
          sy = older[1] + (newer[1] - older[1]) * t;
          sz = older[2] + (newer[2] - older[2]) * t;
          syaw = c_atan2f(newer[0] - older[0], newer[2] - older[2]);
          found = true;
          break;
        }
        if (targetDist < older[3]) {
          cursor++;
        } else {
          break;
        }
      }
      if (!found) {
        const float* tail = spine_at(spineLen - 1);
        const float* prev = spineLen > 1 ? spine_at(spineLen - 2) : tail;
        sx = tail[0];
        sy = tail[1];
        sz = tail[2];
        syaw = c_atan2f(prev[0] - sx, prev[2] - sz);
      }
    }

    float bodyFrac = static_cast<float>(i + 1) / static_cast<float>(segCount);
    float neckRaw = c_fminf(1.0f, c_fmaxf(0.0f, static_cast<float>(i - 1) / 5.5f));
    float neckEase = c_powf_pos(neckRaw, 1.35f);
    float slitherAmp = 0.21f * sc * neckEase * (1.0f - bodyFrac * 0.35f);
    float slitherPhase = (headTotalDist / sc) * 1.65f - static_cast<float>(i) * 0.5f;
    float lateral = c_sinf(slitherPhase) * slitherAmp;

    float perpX = c_cosf(syaw);
    float perpZ = -c_sinf(syaw);
    float px = sx + perpX * lateral;
    float pz = sz + perpZ * lateral;

    float thicknessCurve =
        bodyFrac < 0.2f
            ? 0.8f + (bodyFrac / 0.2f) * 0.25f
            : 1.05f * (1.0f - c_powf_pos((bodyFrac - 0.2f) / 0.8f, 1.38f) * 0.86f);
    float rad = HEAD_RADIUS * sc * 0.88f * thicknessCurve * growthThickBonus;

    float outY = sy + rad * 0.56f;
    // Smooth neck ramp when head climbs over a body coil so upper neck doesn't dip through coils
    if (i < 4 && g_sim.scalars.headY > sy + 0.08f * sc) {
      float liftFrac = 1.0f - static_cast<float>(i) / 4.0f;
      float headBaseTop = g_sim.scalars.headY + HEAD_RADIUS * sc * 0.48f;
      outY = outY + (headBaseTop - outY) * (liftFrac * liftFrac);
    }

    // Keep upper neck segments from telescoping inside the skull during tight turns
    if (i < 4) {
      float minHeadSep = HEAD_RADIUS * sc * (0.58f + static_cast<float>(i) * 0.24f);
      float hdx = px - g_sim.scalars.headX;
      float hdz = pz - g_sim.scalars.headZ;
      float hd = c_hypotf(hdx, hdz);
      if (hd < minHeadSep && c_fabsf(outY - (g_sim.scalars.headY + rad * 0.56f)) < rad * 1.1f) {
        if (hd > 1e-4f) {
          px = g_sim.scalars.headX + (hdx / hd) * minHeadSep;
          pz = g_sim.scalars.headZ + (hdz / hd) * minHeadSep;
        } else {
          px = g_sim.scalars.headX - c_sinf(g_sim.scalars.heading) * minHeadSep;
          pz = g_sim.scalars.headZ - c_cosf(g_sim.scalars.heading) * minHeadSep;
        }
      }
    }

    // Solid push-out for first 16 segments so body coils wrap around trees, logs, rocks, and walls
    if (i < 16 && g_sim.scalars.phase == PHASE_PLAYING) {
      float dummyNx = 0.0f, dummyNz = 0.0f;
      resolve_solid_point(px, pz, sy, rad * 0.95f, dummyNx, dummyNz);
    }

    int32_t out = i * 5;
    g_sim.playerPoses[out] = px;
    g_sim.playerPoses[out + 1] = outY;
    g_sim.playerPoses[out + 2] = pz;
    g_sim.playerPoses[out + 3] = syaw + c_cosf(slitherPhase) * 0.12f;
    g_sim.playerPoses[out + 4] = rad;
  }
}

void sim_recompute_hatchling_poses(int32_t hIdx) {
  if (hIdx < 0 || hIdx >= g_sim.hatchlingCount) return;
  HatchlingSlot& h = g_sim.hatchlings[hIdx];
  int32_t segCount = static_cast<int32_t>(10.0f + h.growth * 6.0f + 0.5f);
  if (segCount > 32) segCount = 32;
  h.poseCount = segCount;
  float spacing = 0.2f + h.growth * 0.08f;
  float baseRad = 0.17f + h.growth * 0.09f;

  const float* hSpine = g_sim.hatchlingSpines[hIdx];
  float* outPoses = g_sim.hatchlingPoses[hIdx];
  for (int32_t i = 0; i < segCount; i++) {
    float sx, sy, sz, syaw;
    sample_generic_spine(hSpine, 0, 63, h.spineLen, h.totalDist, static_cast<float>(i + 1) * spacing, sx, sy, sz, syaw);
    float frac = static_cast<float>(i + 1) / static_cast<float>(segCount);
    float wave = c_sinf(h.totalDist * 2.5f - static_cast<float>(i) * 0.55f) * 0.1f * (0.4f + 0.6f * frac);
    float px = c_cosf(syaw);
    float pz = -c_sinf(syaw);
    float r = baseRad * (1.0f - c_powf_pos(frac, 1.35f) * 0.8f);
    int32_t off = i * 5;
    outPoses[off] = sx + px * wave;
    outPoses[off + 1] = sy + r * 0.58f;
    outPoses[off + 2] = sz + pz * wave;
    outPoses[off + 3] = syaw;
    outPoses[off + 4] = r;
  }
}

static bool is_position_clear(float x, float z, float minRadius, bool avoidSpawnCorridor) {
  float r = c_hypotf(x, z);
  if (r > ARENA_RADIUS - minRadius - 3.5f) return false;
  if (is_inside_village(x, z, 3.5f)) return false;
  if (avoidSpawnCorridor && c_fabsf(x) < 9.0f && z > -24.0f && z < 18.0f) return false;
  if (c_hypotf(x - g_sim.scalars.headX, z - g_sim.scalars.headZ) < minRadius + 4.0f) return false;
  if (is_point_near_building(x, z, minRadius + 2.2f)) return false;

  for (int32_t i = 0; i < g_sim.treeCount; i++) {
    const TreeSlot& tr = g_sim.trees[i];
    if (c_hypotf(x - tr.x, z - tr.z) < tr.radius + minRadius + 1.8f) return false;
  }
  for (int32_t i = 0; i < g_sim.obstacleCount; i++) {
    const ObstacleSlot& obs = g_sim.obstacles[i];
    if (c_hypotf(x - obs.x, z - obs.z) < obs.radius + minRadius + 2.2f) return false;
  }
  for (int32_t i = 0; i < g_sim.preyCount; i++) {
    const PreySlot& pr = g_sim.prey[i];
    if (c_hypotf(x - pr.x, z - pr.z) < pr.radius + minRadius + 1.4f) return false;
  }
  return true;
}

static bool spawn_obstacle() {
  if (g_sim.obstacleCount >= MAX_OBS_POOL) return false;
  for (int32_t attempt = 0; attempt < 55; attempt++) {
    float angle = g_sim.rng.next() * TWO_PI;
    float dist = 16.0f + c_powf_pos(g_sim.rng.next(), 0.7f) * (ARENA_RADIUS - 22.0f);
    float x = c_cosf(angle) * dist;
    float z = c_sinf(angle) * dist;
    int32_t kind = g_sim.rng.next() < 0.56f ? 0 : 1;
    float scale = 0.98f + g_sim.rng.next() * 0.65f;
    float radius = (kind == 0 ? 1.18f : 1.12f) * scale;
    if (is_position_clear(x, z, radius, true)) {
      ObstacleSlot& o = g_sim.obstacles[g_sim.obstacleCount++];
      o.id = g_sim.scalars.nextId++;
      o.kind = kind;
      o.x = x;
      o.z = z;
      o.radius = radius;
      o.rotation = g_sim.rng.next() * TWO_PI;
      o.scale = scale;
      o.pad = 0.0f;
      g_sim.scalars.obstaclesVersion++;
      return true;
    }
  }
  return false;
}

void sim_spawn_prey(
    int32_t hasForcedKind,
    int32_t forcedKind,
    int32_t hasForcedPos,
    float fx,
    float fz,
    int32_t hasForcedY,
    float fy) {
  if (g_sim.preyCount >= MAX_PREY_POOL) return;
  float roll = g_sim.rng.next();
  int32_t kind = hasForcedKind
      ? forcedKind
      : (roll < 0.19f ? PREY_RABBIT
         : roll < 0.35f ? PREY_MOUSE
         : roll < 0.51f ? PREY_FROG
         : roll < 0.65f ? PREY_BERRY
         : roll < 0.77f ? PREY_EGG
         : roll < 0.88f ? PREY_DEER
         : roll < 0.96f ? PREY_BOAR : PREY_ELEPHANT);

  float x = fx, z = fz, y = fy;
  float radius = 0.52f;
  if (kind == PREY_RABBIT) radius = 0.68f;
  else if (kind == PREY_FROG) radius = 0.56f;
  else if (kind == PREY_DEER) radius = 1.05f;
  else if (kind == PREY_BOAR) radius = 0.92f;
  else if (kind == PREY_ELEPHANT) radius = 2.15f;

  bool isLargeWild = (kind == PREY_DEER || kind == PREY_BOAR || kind == PREY_ELEPHANT);

  if (!hasForcedPos) {
    if (!isLargeWild && g_building_count > 0 && g_sim.rng.next() < 0.24f) {
      int32_t bi = static_cast<int32_t>(g_sim.rng.next() * static_cast<float>(g_building_count));
      if (bi >= g_building_count) bi = g_building_count - 1;
      const EnterableBuilding& b = g_buildings[bi];
      bool useInterior = g_sim.rng.next() < 0.6f;
      float sx = useInterior ? b.interiorSpotX : b.upperSpotX;
      float sz = useInterior ? b.interiorSpotZ : b.upperSpotZ;
      float sy = useInterior ? b.interiorSpotY : b.upperSpotY;
      building_local_to_world(
          b,
          sx + (g_sim.rng.next() - 0.5f) * 1.4f,
          sz + (g_sim.rng.next() - 0.5f) * 1.2f,
          x,
          z);
      y = ground_height_at(b.x, b.z) + sy * b.scale;
    } else {
      bool found = false;
      for (int32_t attempt = 0; attempt < 64; attempt++) {
        float angle = g_sim.rng.next() * TWO_PI;
        float minDist = isLargeWild ? 20.0f : 6.0f;
        float dist = minDist + c_powf_pos(g_sim.rng.next(), 0.72f) * (ARENA_RADIUS - minDist - 8.0f);
        float cx = c_cosf(angle) * dist;
        float cz = c_sinf(angle) * dist;
        if (isLargeWild && is_inside_village(cx, cz, 5.0f)) continue;
        if (!is_point_near_building(cx, cz, radius + (isLargeWild ? 3.5f : 1.8f))) {
          x = cx;
          z = cz;
          found = true;
          break;
        }
      }
      if (!found) {
        x = (g_sim.rng.next() - 0.5f) * 40.0f;
        z = 22.0f + g_sim.rng.next() * 34.0f;
      }
      y = ground_height_at(x, z);
    }
  } else if (!hasForcedY) {
    y = ground_height_at(x, z);
  }

  int32_t pts = 25, gr = 2, stam = 20;
  if (kind == PREY_RABBIT)        { pts = 45;  gr = 3; stam = 40; }
  else if (kind == PREY_MOUSE)    { pts = 35;  gr = 2; stam = 28; }
  else if (kind == PREY_FROG)     { pts = 25;  gr = 2; stam = 32; }
  else if (kind == PREY_BERRY)    { pts = 15;  gr = 1; stam = 16; }
  else if (kind == PREY_DEER)     { pts = 85;  gr = 5; stam = 55; }
  else if (kind == PREY_BOAR)     { pts = 75;  gr = 4; stam = 48; }
  else if (kind == PREY_ELEPHANT) { pts = 180; gr = 9; stam = 90; }

  PreySlot& p = g_sim.prey[g_sim.preyCount++];
  p.id = g_sim.scalars.nextId++;
  p.kind = kind;
  p.points = pts;
  p.growth = gr;
  p.staminaGain = stam;
  p.fleeing = 0;
  p.x = x;
  p.y = y;
  p.z = z;
  p.vx = 0.0f;
  p.vz = 0.0f;
  p.heading = g_sim.rng.next() * TWO_PI;
  p.radius = radius;
  p.phase = g_sim.rng.next() * TWO_PI;
  p.gaitPhase = g_sim.rng.next() * TWO_PI;
  p.idleTimer = g_sim.rng.next() * 1.2f;
}

int32_t sim_spawn_villager(
    int32_t role,
    float x,
    float z,
    int32_t tier,
    int32_t isElite,
    int32_t homeVillageId) {
  if (g_sim.villagerCount >= MAX_VILLAGER_POOL) return -1;

  int32_t vHome = (homeVillageId >= 0 && homeVillageId < NUM_VILLAGES)
      ? homeVillageId
      : nearest_village_id(x, z);

  static const int32_t HAIRS[5] = {0x241912, 0x4f3522, 0x825d37, 0x181513, 0x726d67};
  static const int32_t SKINS[5] = {0xe4ba97, 0xd5a07a, 0xc38963, 0xebcbb1, 0xb07652};
  static const int32_t FACTION_CIV[NUM_VILLAGES] = {
    0x5c809e, 0xb85242, 0x7b5aa6, 0xd49a35, 0x567f8c, 0x4b8f5c, 0xc97438
  };
  static const int32_t FACTION_GUARD[NUM_VILLAGES] = {
    0x2f4d66, 0x822c24, 0x4b336e, 0x946519, 0x334d57, 0x2c5c39, 0x8a481e
  };
  static const int32_t TROUSERS[4] = {0x2b251f, 0x36312a, 0x222830, 0x342921};

  int32_t idx = g_sim.scalars.nextId;
  bool isHunter = (role == ROLE_SPEARMAN || role == ROLE_CROSSBOW);
  int32_t shirtColor = isHunter ? FACTION_GUARD[vHome] : FACTION_CIV[vHome];
  if (isElite) {
    shirtColor = (shirtColor & 0xfefefe) >> 1; // Rich darkened elite armor/tunic trim
    shirtColor |= 0x401010;
  }

  float baseHp = (role == ROLE_SPEARMAN) ? 68.0f : (role == ROLE_CROSSBOW ? 54.0f : 42.0f);
  float hpMult = isHunter ? 1.0f + static_cast<float>(tier > 1 ? tier - 1 : 0) * 0.16f + (isElite ? 0.55f : 0.0f) : 1.0f;
  float maxHp = c_floorf(baseHp * hpMult + 0.5f);

  int32_t vIdx = g_sim.villagerCount++;
  VillagerSlot& v = g_sim.villagers[vIdx];
  v.id = g_sim.scalars.nextId++;
  v.role = role;
  v.state = VSTATE_PATROL;
  v.hp = maxHp;
  v.maxHp = maxHp;
  v.targetBuildingId = -1;
  v.shirtColor = shirtColor;
  v.trouserColor = TROUSERS[idx % 4];
  v.hairColor = HAIRS[idx % 5];
  v.skinTone = SKINS[idx % 5];
  v.hasBeard = ((isHunter || (idx % 3 == 0)) && (idx % 2 == 0)) ? 1 : 0;
  v.isElite = isElite;
  v.tier = tier;
  v.x = x;
  v.y = surface_height_at(x, z, ground_height_at(x, z));
  v.z = z;
  v.vx = 0.0f;
  v.vz = 0.0f;
  v.heading = g_sim.rng.next() * TWO_PI;
  v.radius = isElite ? 0.72f : 0.64f;
  v.speed = 0.0f;
  v.gaitPhase = g_sim.rng.next() * TWO_PI;
  v.phase = g_sim.rng.next() * TWO_PI;
  v.homeX = x;
  v.homeZ = z;
  v.stateTimer = 0.8f + g_sim.rng.next() * 1.6f;
  v.attackCooldown = 0.5f + g_sim.rng.next() * 0.8f;
  v.hitFlash = 0.0f;
  v.koTimer = 0.0f;
  v.poisonTimer = 0.0f;
  v.stunTimer = 0.0f;
  v.grabbed = 0;
  v.homeVillageId = vHome;
  v.targetVillagerId = -1;
  v.herdedTimer = 0.0f;
  v.padV1 = 0;
  return vIdx;
}

static void seed_interior_forest_trees() {
  g_sim.treeCount = 0;
  SeededRng treeRng;
  treeRng.reset(4242u);

  // Decorative shade trees just inside Timberhollow and main villages along corners
  for (int32_t vi = 0; vi < NUM_VILLAGES && g_sim.treeCount + 2 <= MAX_TREE_POOL; vi++) {
    const VillageDef& v = g_villages[vi];
    float ox[2] = {-v.halfW + 4.5f, v.halfW - 4.5f};
    float oz[2] = {v.halfD - 5.5f, -v.halfD + 5.5f};
    for (int32_t k = 0; k < 2; k++) {
      TreeSlot& t = g_sim.trees[g_sim.treeCount++];
      t.id = g_sim.scalars.nextId++;
      t.kind = (vi + k) & 1;
      t.x = v.centerX + ox[k];
      t.z = v.centerZ + oz[k];
      t.scale = 1.05f + 0.08f * static_cast<float>(k);
      t.radius = 0.76f * t.scale;
      t.pad0 = t.pad1 = 0.0f;
    }
  }

  const int32_t targetCount = 260;
  for (int32_t attempt = 0; attempt < targetCount * 6 && g_sim.treeCount < targetCount && g_sim.treeCount < MAX_TREE_POOL; attempt++) {
    float angle = treeRng.next() * TWO_PI;
    float dist = 18.0f + c_powf_pos(treeRng.next(), 0.62f) * (ARENA_RADIUS - 22.0f);
    float x = c_cosf(angle) * dist;
    float z = c_sinf(angle) * dist;

    if (is_inside_village(x, z, 6.0f)) continue;
    if (c_fabsf(x) < 11.5f && z > -24.0f && z < 20.0f) continue;
    if (c_hypotf(x + 11.5f, z + 6.5f) < 7.0f) continue;
    if (is_point_near_building(x, z, 6.5f)) continue;

    bool tooClose = false;
    for (int32_t ti = 0; ti < g_sim.treeCount; ti++) {
      if (c_hypotf(x - g_sim.trees[ti].x, z - g_sim.trees[ti].z) < 7.6f) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    float scale = 0.90f + treeRng.next() * 0.60f;
    TreeSlot& t = g_sim.trees[g_sim.treeCount++];
    t.id = g_sim.scalars.nextId++;
    t.kind = treeRng.next() < 0.64f ? 0 : 1;
    t.x = x;
    t.z = z;
    t.scale = scale;
    t.radius = 0.76f * scale;
    t.pad0 = t.pad1 = 0.0f;
  }
}

void sim_init(uint32_t seed) {
  g_sim.rng.reset(seed);
  g_sim.scalars.phase = PHASE_TITLE;
  g_sim.scalars.cameraMode = CAM_CHASE;
  g_sim.scalars.species = SPECIES_EMERALD;
  g_sim.scalars.difficulty = DIFF_REALISTIC;
  g_sim.scalars.turnSensitivity = 1.0f;
  g_sim.scalars.muted = 0;
  g_sim.scalars.bestScore = 0.0f;
  g_sim.scalars.nextId = 1;
  g_sim.scalars.obstaclesVersion = 1;
  init_world_buildings_and_fences();
  sim_reset_world(true);
}

void sim_reset_world(bool isTitleDemo) {
  init_world_buildings_and_fences();

  g_sim.scalars.headX = 0.0f;
  g_sim.scalars.headZ = 4.0f;
  g_sim.scalars.headY = ground_height_at(0.0f, 4.0f);
  g_sim.scalars.headVelY = 0.0f;
  g_sim.scalars.heading = PI;
  g_sim.scalars.totalDist = 24.0f;

  g_sim.scalars.snakeScale = START_SNAKE_SCALE;
  g_sim.scalars.speed = isTitleDemo ? BASE_SPEED : 0.0f;
  g_sim.scalars.stamina = 100.0f;
  g_sim.scalars.isBoosting = 0;
  g_sim.scalars.hp = static_cast<float>(MAX_SNAKE_HP);
  g_sim.scalars.maxHp = MAX_SNAKE_HP;
  g_sim.scalars.invulnTimer = 0.0f;
  g_sim.scalars.outOfCombatTimer = 0.0f;
  g_sim.scalars.kills = 0;
  g_sim.scalars.feastCount = 0;
  g_sim.scalars.powerTier = 1;
  g_sim.scalars.rivalClashActive = 0;
  g_sim.scalars.activeVillageId = -1;
  g_sim.scalars.secondaryCooldown = 0.0f;
  g_sim.scalars.secondaryMaxCooldown = 7.5f;
  g_sim.scalars.swallowBulgeT = 0.0f;
  g_sim.rivalEventCd = 0.0f;

  g_sim.scalars.segmentCount = INITIAL_SEGMENTS;
  g_sim.scalars.score = 0.0f;
  g_sim.scalars.combo = 1;
  g_sim.scalars.comboTimer = 0.0f;
  g_sim.scalars.elapsedSeconds = 0.0f;
  g_sim.scalars.deathReason = DEATH_NONE;
  g_sim.scalars.mouthOpen = 0.0f;
  g_sim.scalars.tongueTimer = 0.0f;
  g_sim.scalars.nearPrey = 0;
  g_sim.scalars.hunterAlert = 0;
  g_sim.scalars.raidHeat = 0.0f;
  g_sim.scalars.threatLevel = 1;
  g_sim.scalars.activeBuildingId = -1;
  g_sim.scalars.hideActiveRoof = 0;
  g_sim.scalars.isIndoors = 0;
  g_sim.scalars.locZoneType = 4;
  g_sim.scalars.locZoneIdx = 0;
  g_sim.scalars.locBuildingIdx = -1;
  g_sim.scalars.eggCooldown = 0.0f;
  g_sim.scalars.totalHatched = 0;
  g_sim.scalars.lastHazardScoreMilestone = 0.0f;
  g_sim.scalars.villagerReinforceTimer = 10.0f;
  g_sim.scalars.grabTargetId = -1;
  g_sim.scalars.grabStage = 0;
  g_sim.scalars.powerPulseKind = 0;
  g_sim.scalars.powerCooldown = 0.0f;
  g_sim.scalars.powerMaxCooldown = 3.5f;
  g_sim.scalars.tailGrabCooldown = 0.0f;
  g_sim.scalars.tailGrabMaxCooldown = 6.0f;
  g_sim.scalars.grabTimer = 0.0f;
  g_sim.scalars.grabWhipTimer = 0.0f;
  g_sim.scalars.grabOriginX = 0.0f;
  g_sim.scalars.grabOriginY = 0.0f;
  g_sim.scalars.grabOriginZ = 0.0f;
  g_sim.scalars.stealthTimer = 0.0f;
  g_sim.scalars.powerPulseTimer = 0.0f;
  g_sim.scalars.powerPulseX = 0.0f;
  g_sim.scalars.powerPulseY = 0.0f;
  g_sim.scalars.powerPulseZ = 0.0f;
  g_sim.scalars.padEnd = 0.0f;
  g_sim.strikeCdCount = 0;

  seed_interior_forest_trees();

  g_sim.spineHeadIdx = 0;
  const int32_t spineSamples = 180;
  g_sim.scalars.spineLen = spineSamples;
  const float step = 0.25f;
  for (int32_t i = 0; i < spineSamples; i++) {
    float backDist = static_cast<float>(i) * step;
    float sx = g_sim.scalars.headX + c_sinf(backDist * 0.45f) * 0.24f * c_fminf(1.0f, backDist * 0.35f);
    float sz = g_sim.scalars.headZ + backDist;
    float* sp = spine_at(i);
    sp[0] = sx;
    sp[1] = ground_height_at(sx, sz);
    sp[2] = sz;
    sp[3] = g_sim.scalars.totalDist - backDist;
  }

  g_sim.obstacleCount = 0;
  g_sim.preyCount = 0;
  g_sim.villagerCount = 0;
  g_sim.eggCount = 0;
  g_sim.hatchlingCount = 0;
  g_sim.projectileCount = 0;
  g_sim.scalars.obstaclesVersion++;

  DifficultyParams diff = get_diff_params(g_sim.scalars.difficulty);
  int32_t initialNatural = isTitleDemo ? 44 : diff.initialObs + 32;
  for (int32_t i = 0; i < initialNatural; i++) {
    spawn_obstacle();
  }

  // Starter wildlife clearing outside Timberhollow South Gate & forest herds
  sim_spawn_prey(1, PREY_RABBIT,   1, -3.2f, -5.8f, 0, 0.0f);
  sim_spawn_prey(1, PREY_FROG,     1, -11.2f, -6.5f, 0, 0.0f);
  sim_spawn_prey(1, PREY_BERRY,    1, 2.8f, -4.5f, 0, 0.0f);
  sim_spawn_prey(1, PREY_EGG,      1, 3.6f, -8.5f, 0, 0.0f);
  sim_spawn_prey(1, PREY_EGG,      1, -4.2f, -11.5f, 0, 0.0f);
  sim_spawn_prey(1, PREY_DEER,     1, -15.5f, 11.5f, 0, 0.0f);
  sim_spawn_prey(1, PREY_BOAR,     1, 16.5f, 9.5f, 0, 0.0f);
  sim_spawn_prey(1, PREY_DEER,     1, 32.0f, -10.5f, 0, 0.0f);
  sim_spawn_prey(1, PREY_BOAR,     1, -34.0f, -11.5f, 0, 0.0f);
  sim_spawn_prey(1, PREY_ELEPHANT, 1, 56.0f, -34.0f, 0, 0.0f);
  sim_spawn_prey(1, PREY_ELEPHANT, 1, -58.0f, -38.0f, 0, 0.0f);
  sim_spawn_prey(1, PREY_DEER,     1, -12.0f, 44.0f, 0, 0.0f);
  sim_spawn_prey(1, PREY_BOAR,     1, 24.0f, 48.0f, 0, 0.0f);
  sim_spawn_prey(1, PREY_ELEPHANT, 1, 6.0f, 76.0f, 0, 0.0f);

  for (int32_t bi = 0; bi < g_building_count && g_sim.preyCount < MAX_PREY_COUNT; bi++) {
    const EnterableBuilding& b = g_buildings[bi];
    float baseY = ground_height_at(b.x, b.z);
    float ix, iz, lx, lz;
    building_local_to_world(b, b.interiorSpotX, b.interiorSpotZ, ix, iz);
    sim_spawn_prey(1, PREY_MOUSE, 1, ix, iz, 1, baseY + b.interiorSpotY * b.scale);

    building_local_to_world(b, b.upperSpotX, b.upperSpotZ, lx, lz);
    sim_spawn_prey(1, b.kind == BLDG_MANOR ? PREY_RABBIT : PREY_EGG, 1, lx, lz, 1, baseY + b.upperSpotY * b.scale);
  }

  while (g_sim.preyCount < MAX_PREY_COUNT) {
    sim_spawn_prey(0, 0, 0, 0.0f, 0.0f, 0, 0.0f);
  }

  // Populate all 7 spaced-apart villages cleanly with 7 villagers each (49 town residents)
  struct LocalSpot { float dx, dz; int32_t role; };
  static const LocalSpot TOWN_SPOTS[7] = {
    {-12.0f,  16.0f, ROLE_FLEE},
    { 13.0f,  14.0f, ROLE_HIDE},
    {-14.0f, -14.0f, ROLE_HIDE},
    { 14.0f, -16.0f, ROLE_FLEE},
    { -6.5f,   7.5f, ROLE_SPEARMAN},
    {  7.0f,  -7.5f, ROLE_SPEARMAN},
    {  0.0f,  19.0f, ROLE_CROSSBOW},
  };
  for (int32_t vi = 0; vi < NUM_VILLAGES; vi++) {
    const VillageDef& vg = g_villages[vi];
    int32_t vTier = vi == 0 ? 1 : (vi <= 2 ? 2 : 3);
    for (int32_t s = 0; s < 7; s++) {
      sim_spawn_villager(
          TOWN_SPOTS[s].role,
          vg.centerX + TOWN_SPOTS[s].dx,
          vg.centerZ + TOWN_SPOTS[s].dz,
          vTier,
          (vi >= 3 && s == 6) ? 1 : 0,
          vi);
    }
  }

  // 7 Border Scouts on approach roads outside villages (ready to spark inter-village chaos!)
  static const struct { float x, z; int32_t role; int32_t homeV; } BORDER_SCOUTS[7] = {
    {-48.0f, -64.0f, ROLE_SPEARMAN, 0},
    {-82.0f, -92.0f, ROLE_SPEARMAN, 1},
    { 82.0f, -92.0f, ROLE_CROSSBOW, 2},
    {-128.0f, -24.0f, ROLE_SPEARMAN, 3},
    { 128.0f, -24.0f, ROLE_SPEARMAN, 4},
    { -68.0f, 118.0f, ROLE_CROSSBOW, 5},
    {  68.0f, 118.0f, ROLE_SPEARMAN, 6},
  };
  for (int32_t i = 0; i < 7; i++) {
    sim_spawn_villager(
        BORDER_SCOUTS[i].role,
        BORDER_SCOUTS[i].x,
        BORDER_SCOUTS[i].z,
        1,
        0,
        BORDER_SCOUTS[i].homeV);
  }

  sim_compute_segment_poses();
}

void sim_set_phase(int32_t nextPhase) {
  if (g_sim.scalars.phase == nextPhase) return;
  g_sim.scalars.phase = nextPhase;
  push_event(EVT_PHASE_CHANGE, nextPhase, 0, 0, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f);
}

void sim_start_game() {
  sim_reset_world(false);
  sim_set_phase(PHASE_PLAYING);
}

void sim_toggle_pause() {
  if (g_sim.scalars.phase == PHASE_PLAYING) {
    sim_set_phase(PHASE_PAUSED);
  } else if (g_sim.scalars.phase == PHASE_PAUSED) {
    sim_set_phase(PHASE_PLAYING);
  }
}

bool sim_can_lay_egg() {
  return g_sim.scalars.phase == PHASE_PLAYING &&
         g_sim.scalars.eggCooldown <= 0.0f &&
         g_sim.scalars.stamina >= EGG_STAMINA_COST &&
         g_sim.eggCount < 4;
}

bool sim_lay_egg() {
  if (!sim_can_lay_egg() || g_sim.eggCount >= MAX_EGG_POOL) return false;
  int32_t segCount = g_sim.scalars.segmentCount;
  int32_t tailIdx = static_cast<int32_t>(static_cast<float>(segCount) * 0.65f);
  if (tailIdx < 4) tailIdx = 4;
  if (tailIdx >= segCount) tailIdx = segCount - 1;

  float ex, ez;
  if (tailIdx >= 0 && segCount > 0) {
    ex = g_sim.playerPoses[tailIdx * 5];
    ez = g_sim.playerPoses[tailIdx * 5 + 2];
  } else {
    ex = g_sim.scalars.headX - c_sinf(g_sim.scalars.heading) * 1.8f;
    ez = g_sim.scalars.headZ - c_cosf(g_sim.scalars.heading) * 1.8f;
  }
  float ey = surface_height_at(ex, ez, g_sim.scalars.headY);

  LaidEggSlot& egg = g_sim.laidEggs[g_sim.eggCount++];
  egg.id = g_sim.scalars.nextId++;
  egg.species = g_sim.scalars.species;
  egg.x = ex;
  egg.y = ey;
  egg.z = ez;
  egg.age = 0.0f;
  egg.hatchTime = EGG_HATCH_TIME_SEC;
  egg.pad = 0.0f;

  g_sim.scalars.stamina = c_fmaxf(0.0f, g_sim.scalars.stamina - EGG_STAMINA_COST);
  g_sim.scalars.eggCooldown = EGG_COOLDOWN_SEC;
  push_event(EVT_LAY_EGG, egg.id, egg.species, 0, ex, ey, ez, 0.0f, 0.0f);
  return true;
}

static void hit_villager(int32_t vIdx, float damage, bool byHatchling, int32_t attackerVillageId = -1);

static void spawn_player_venom_proj(
    int32_t kind,
    int32_t damage,
    float angleOffset,
    float speed,
    float vyBoost,
    float life,
    float radius) {
  if (g_sim.projectileCount >= MAX_PROJ_POOL) return;
  float yaw = normalize_angle(g_sim.scalars.heading + angleOffset);
  float fx = c_sinf(yaw);
  float fz = c_cosf(yaw);
  float sc = c_clampf(g_sim.scalars.snakeScale, START_SNAKE_SCALE, MAX_SNAKE_SCALE);
  ProjectileSlot& pr = g_sim.projectiles[g_sim.projectileCount++];
  pr.id = g_sim.scalars.nextId++;
  pr.damage = damage;
  pr.x = g_sim.scalars.headX + fx * (0.55f * sc + 0.2f);
  pr.y = g_sim.scalars.headY + 0.42f * sc + 0.1f;
  pr.z = g_sim.scalars.headZ + fz * (0.55f * sc + 0.2f);
  pr.vx = fx * speed;
  pr.vy = vyBoost;
  pr.vz = fz * speed;
  pr.yaw = yaw;
  pr.life = life;
  pr.kind = kind;
  pr.radius = radius;
  pr.ownerVillageId = -1;
  pr.padP1 = pr.padP2 = pr.padP3 = 0;
}

static void shatter_nearby_hunter_bolts(float cx, float cz, float radius) {
  for (int32_t i = g_sim.projectileCount - 1; i >= 0; i--) {
    if (g_sim.projectiles[i].kind != PROJ_BOLT) continue;
    float d = c_hypotf(g_sim.projectiles[i].x - cx, g_sim.projectiles[i].z - cz);
    if (d <= radius) {
      g_sim.projectiles[i] = g_sim.projectiles[--g_sim.projectileCount];
    }
  }
}

bool sim_trigger_primary_power() {
  if (g_sim.scalars.phase != PHASE_PLAYING) return false;
  if (g_sim.scalars.powerCooldown > 0.0f) return false;

  int32_t sp = g_sim.scalars.species;
  int32_t pTier = g_sim.scalars.powerTier;
  float tierDmgBonus = 1.0f + static_cast<float>(pTier - 1) * 0.16f;
  float tierRadBonus = pTier >= 3 ? 2.2f : 0.0f;

  float hx = g_sim.scalars.headX;
  float hy = g_sim.scalars.headY;
  float hz = g_sim.scalars.headZ;
  g_sim.scalars.mouthOpen = 1.0f;

  if (pTier >= 3) {
    shatter_nearby_hunter_bolts(hx, hz, 8.5f);
  }

  if (sp == SPECIES_GOLDEN) {
    g_sim.scalars.powerMaxCooldown = 3.4f;
    g_sim.scalars.powerCooldown = 3.4f;
    static const float OFFSETS[7] = {-0.46f, -0.30f, -0.15f, 0.0f, 0.15f, 0.30f, 0.46f};
    for (int32_t i = 0; i < 7; i++) {
      float spd = 17.5f + ((i & 1) ? 1.8f : 0.0f);
      spawn_player_venom_proj(PROJ_VENOM, static_cast<int32_t>(26.0f * tierDmgBonus), OFFSETS[i], spd, 1.6f, 1.15f, 0.42f);
    }
    g_sim.scalars.powerPulseKind = SPECIES_GOLDEN;
    g_sim.scalars.powerPulseTimer = 0.42f;
    g_sim.scalars.powerPulseX = hx;
    g_sim.scalars.powerPulseY = hy + 0.35f;
    g_sim.scalars.powerPulseZ = hz;
    push_event(EVT_POWER_USED, SPECIES_GOLDEN, 7, 0, hx, hy, hz, 8.0f + tierRadBonus, 0.0f);
    return true;
  }

  if (sp == SPECIES_CORAL) {
    g_sim.scalars.powerMaxCooldown = 2.8f;
    g_sim.scalars.powerCooldown = 2.8f;
    static const float OFFSETS[3] = {-0.13f, 0.0f, 0.13f};
    for (int32_t i = 0; i < 3; i++) {
      spawn_player_venom_proj(PROJ_VENOM, static_cast<int32_t>(34.0f * tierDmgBonus), OFFSETS[i], 23.5f, 0.95f, 1.05f, 0.38f);
    }
    g_sim.scalars.stamina = c_fminf(100.0f, g_sim.scalars.stamina + 20.0f);
    g_sim.scalars.powerPulseKind = SPECIES_CORAL;
    g_sim.scalars.powerPulseTimer = 0.36f;
    g_sim.scalars.powerPulseX = hx;
    g_sim.scalars.powerPulseY = hy + 0.35f;
    g_sim.scalars.powerPulseZ = hz;
    push_event(EVT_POWER_USED, SPECIES_CORAL, 3, 0, hx, hy, hz, 10.0f + tierRadBonus, 0.0f);
    return true;
  }

  if (sp == SPECIES_OBSIDIAN) {
    g_sim.scalars.powerMaxCooldown = 4.8f;
    g_sim.scalars.powerCooldown = 4.8f;
    float radius = 7.4f + tierRadBonus;
    int32_t hits = 0;
    shatter_nearby_hunter_bolts(hx, hz, radius + 1.2f);
    for (int32_t vi = g_sim.villagerCount - 1; vi >= 0; vi--) {
      VillagerSlot& v = g_sim.villagers[vi];
      if (v.state == VSTATE_KO) continue;
      float dx = v.x - hx;
      float dz = v.z - hz;
      float d = c_hypotf(dx, dz);
      if (d <= radius && c_fabsf(v.y - hy) < 2.8f) {
        hits++;
        v.stunTimer = c_fmaxf(v.stunTimer, 1.5f);
        float invD = d > 0.05f ? (1.0f / d) : 1.0f;
        v.x += dx * invD * 2.1f;
        v.z += dz * invD * 2.1f;
        hit_villager(vi, 44.0f * tierDmgBonus, false, -1);
      }
    }
    g_sim.scalars.powerPulseKind = SPECIES_OBSIDIAN;
    g_sim.scalars.powerPulseTimer = 0.65f;
    g_sim.scalars.powerPulseX = hx;
    g_sim.scalars.powerPulseY = hy + 0.12f;
    g_sim.scalars.powerPulseZ = hz;
    push_event(EVT_POWER_USED, SPECIES_OBSIDIAN, hits, 0, hx, hy, hz, radius, 0.0f);
    return true;
  }

  if (sp == SPECIES_RATTLER) {
    g_sim.scalars.powerMaxCooldown = 4.2f;
    g_sim.scalars.powerCooldown = 4.2f;
    float radius = 8.4f + tierRadBonus;
    int32_t hits = 0;
    shatter_nearby_hunter_bolts(hx, hz, radius + 1.0f);
    for (int32_t vi = g_sim.villagerCount - 1; vi >= 0; vi--) {
      VillagerSlot& v = g_sim.villagers[vi];
      if (v.state == VSTATE_KO) continue;
      float d = c_hypotf(v.x - hx, v.z - hz);
      if (d <= radius && c_fabsf(v.y - hy) < 3.0f) {
        hits++;
        v.stunTimer = c_fmaxf(v.stunTimer, 2.8f);
        v.poisonTimer = c_fmaxf(v.poisonTimer, 3.2f);
        hit_villager(vi, 24.0f * tierDmgBonus, false, -1);
      }
    }
    g_sim.scalars.powerPulseKind = SPECIES_RATTLER;
    g_sim.scalars.powerPulseTimer = 0.65f;
    g_sim.scalars.powerPulseX = hx;
    g_sim.scalars.powerPulseY = hy + 0.15f;
    g_sim.scalars.powerPulseZ = hz;
    push_event(EVT_POWER_USED, SPECIES_RATTLER, hits, 0, hx, hy, hz, radius, 0.0f);
    return true;
  }

  if (sp == SPECIES_ALBINO) {
    g_sim.scalars.powerMaxCooldown = 5.4f;
    g_sim.scalars.powerCooldown = 5.4f;
    g_sim.scalars.stealthTimer = 3.8f;
    spawn_player_venom_proj(PROJ_VENOM, static_cast<int32_t>(30.0f * tierDmgBonus), -0.08f, 21.0f, 0.8f, 1.0f, 0.36f);
    spawn_player_venom_proj(PROJ_VENOM, static_cast<int32_t>(30.0f * tierDmgBonus), 0.08f, 21.0f, 0.8f, 1.0f, 0.36f);
    for (int32_t vi = 0; vi < g_sim.villagerCount; vi++) {
      VillagerSlot& v = g_sim.villagers[vi];
      if (v.state == VSTATE_KO) continue;
      if ((v.role == ROLE_SPEARMAN || v.role == ROLE_CROSSBOW) &&
          c_hypotf(v.x - hx, v.z - hz) > 4.5f) {
        v.state = VSTATE_PATROL;
      }
    }
    g_sim.scalars.powerPulseKind = SPECIES_ALBINO;
    g_sim.scalars.powerPulseTimer = 0.55f;
    g_sim.scalars.powerPulseX = hx;
    g_sim.scalars.powerPulseY = hy + 0.25f;
    g_sim.scalars.powerPulseZ = hz;
    push_event(EVT_POWER_USED, SPECIES_ALBINO, 2, 0, hx, hy, hz, 6.0f + tierRadBonus, 0.0f);
    return true;
  }

  g_sim.scalars.powerMaxCooldown = 3.6f;
  g_sim.scalars.powerCooldown = 3.6f;
  static const float MIST_OFF[5] = {-0.52f, -0.25f, 0.0f, 0.25f, 0.52f};
  for (int32_t i = 0; i < 5; i++) {
    spawn_player_venom_proj(PROJ_MIST, static_cast<int32_t>(22.0f * tierDmgBonus), MIST_OFF[i], 13.5f, 0.7f, 0.95f, 0.62f);
  }
  int32_t mistHits = 0;
  for (int32_t vi = g_sim.villagerCount - 1; vi >= 0; vi--) {
    VillagerSlot& v = g_sim.villagers[vi];
    if (v.state == VSTATE_KO) continue;
    if (c_hypotf(v.x - hx, v.z - hz) <= 5.2f + tierRadBonus && c_fabsf(v.y - hy) < 2.6f) {
      mistHits++;
      v.poisonTimer = c_fmaxf(v.poisonTimer, 5.0f);
      hit_villager(vi, 18.0f * tierDmgBonus, false, -1);
    }
  }
  g_sim.scalars.hp = c_fminf(static_cast<float>(g_sim.scalars.maxHp), g_sim.scalars.hp + 12.0f);
  g_sim.scalars.powerPulseKind = SPECIES_EMERALD;
  g_sim.scalars.powerPulseTimer = 0.55f;
  g_sim.scalars.powerPulseX = hx;
  g_sim.scalars.powerPulseY = hy + 0.2f;
  g_sim.scalars.powerPulseZ = hz;
  push_event(EVT_POWER_USED, SPECIES_EMERALD, mistHits + 5, 0, hx, hy, hz, 5.2f + tierRadBonus, 0.0f);
  return true;
}

bool sim_trigger_secondary_power() {
  if (g_sim.scalars.phase != PHASE_PLAYING) return false;
  if (g_sim.scalars.powerTier < 2 || g_sim.scalars.secondaryCooldown > 0.0f) return false;

  float hx = g_sim.scalars.headX;
  float hy = g_sim.scalars.headY;
  float hz = g_sim.scalars.headZ;
  g_sim.scalars.mouthOpen = 1.0f;
  g_sim.scalars.secondaryMaxCooldown = 7.5f;
  g_sim.scalars.secondaryCooldown = 7.5f;

  int32_t hits = 0;
  if (g_sim.scalars.powerTier >= 4) {
    // Tier 4 Apex Rampage Nova
    float radius = 12.5f;
    shatter_nearby_hunter_bolts(hx, hz, radius + 2.0f);
    for (int32_t vi = g_sim.villagerCount - 1; vi >= 0; vi--) {
      VillagerSlot& v = g_sim.villagers[vi];
      if (v.state == VSTATE_KO) continue;
      float dx = v.x - hx;
      float dz = v.z - hz;
      float d = c_hypotf(dx, dz);
      if (d <= radius && c_fabsf(v.y - hy) < 3.6f) {
        hits++;
        v.stunTimer = c_fmaxf(v.stunTimer, 2.6f);
        v.poisonTimer = c_fmaxf(v.poisonTimer, 4.2f);
        float invD = d > 0.05f ? (1.0f / d) : 1.0f;
        v.x += dx * invD * 2.8f;
        v.z += dz * invD * 2.8f;
        hit_villager(vi, 68.0f, false, -1);
      }
    }
    g_sim.scalars.hp = c_fminf(static_cast<float>(g_sim.scalars.maxHp), g_sim.scalars.hp + 30.0f);
    g_sim.scalars.stamina = c_fminf(100.0f, g_sim.scalars.stamina + 60.0f);
    g_sim.scalars.snakeScale = c_fminf(MAX_SNAKE_SCALE, g_sim.scalars.snakeScale + 0.03f);
    g_sim.scalars.powerPulseKind = 4;
    g_sim.scalars.powerPulseTimer = 0.72f;
    g_sim.scalars.powerPulseX = hx;
    g_sim.scalars.powerPulseY = hy + 0.25f;
    g_sim.scalars.powerPulseZ = hz;
    push_event(EVT_SECONDARY_POWER, 4, hits, 0, hx, hy, hz, radius, 0.0f);
    return true;
  }

  // Tier 2/3 Blood Frenzy
  static const float FAN[6] = {-0.55f, -0.32f, -0.11f, 0.11f, 0.32f, 0.55f};
  for (int32_t i = 0; i < 6; i++) {
    spawn_player_venom_proj(PROJ_VENOM, 32, FAN[i], 20.5f, 1.1f, 1.05f, 0.44f);
  }
  g_sim.scalars.hp = c_fminf(static_cast<float>(g_sim.scalars.maxHp), g_sim.scalars.hp + 22.0f);
  g_sim.scalars.stamina = c_fminf(100.0f, g_sim.scalars.stamina + 45.0f);
  g_sim.scalars.stealthTimer = c_fmaxf(g_sim.scalars.stealthTimer, 2.5f);
  g_sim.scalars.powerPulseKind = 2;
  g_sim.scalars.powerPulseTimer = 0.52f;
  g_sim.scalars.powerPulseX = hx;
  g_sim.scalars.powerPulseY = hy + 0.25f;
  g_sim.scalars.powerPulseZ = hz;
  push_event(EVT_SECONDARY_POWER, 2, 6, 0, hx, hy, hz, 8.5f, 0.0f);
  return true;
}

bool sim_trigger_tail_grab() {
  if (g_sim.scalars.phase != PHASE_PLAYING) return false;
  if (g_sim.scalars.tailGrabCooldown > 0.0f || g_sim.scalars.grabStage == 1) return false;

  int32_t segCount = g_sim.scalars.segmentCount;
  if (segCount < 3) segCount = 3;
  int32_t tailIdx = (segCount - 1) * 5;
  float tx = g_sim.playerPoses[tailIdx];
  float ty = g_sim.playerPoses[tailIdx + 1];
  float tz = g_sim.playerPoses[tailIdx + 2];

  float hx = g_sim.scalars.headX;
  float hy = g_sim.scalars.headY;
  float hz = g_sim.scalars.headZ;

  float grabRange = g_sim.scalars.powerTier >= 3 ? 13.2f : 9.6f;
  int32_t bestIdx = -1;
  float bestScore = grabRange + 0.4f;
  for (int32_t vi = 0; vi < g_sim.villagerCount; vi++) {
    const VillagerSlot& v = g_sim.villagers[vi];
    if (v.state == VSTATE_KO || v.grabbed != 0) continue;
    float dt = c_hypotf(v.x - tx, v.z - tz);
    float dh = c_hypotf(v.x - hx, v.z - hz);
    float dMin = dt < dh ? dt : dh;
    if (dMin <= grabRange && c_fabsf(v.y - hy) < 4.0f) {
      if (dMin < bestScore) {
        bestScore = dMin;
        bestIdx = vi;
      }
    }
  }

  if (bestIdx >= 0) {
    VillagerSlot& target = g_sim.villagers[bestIdx];
    target.grabbed = 1;
    target.state = VSTATE_RECOVER;
    target.hitFlash = 1.0f;
    g_sim.scalars.grabTargetId = target.id;
    g_sim.scalars.grabStage = 1;
    g_sim.scalars.grabTimer = 0.52f;
    g_sim.scalars.grabWhipTimer = 0.68f;
    g_sim.scalars.grabOriginX = target.x;
    g_sim.scalars.grabOriginY = target.y;
    g_sim.scalars.grabOriginZ = target.z;
    g_sim.scalars.tailGrabCooldown = 6.0f;
    g_sim.scalars.tailGrabMaxCooldown = 6.0f;
    push_event(EVT_TAIL_GRAB, target.id, 1, 0, target.x, target.y, target.z, 0.0f, 0.0f);
    return true;
  }

  g_sim.scalars.grabTargetId = -1;
  g_sim.scalars.grabStage = 0;
  g_sim.scalars.grabWhipTimer = 0.35f;
  g_sim.scalars.tailGrabCooldown = 1.1f;
  g_sim.scalars.tailGrabMaxCooldown = 1.1f;
  push_event(EVT_TAIL_GRAB, -1, 0, 0, tx, ty, tz, 0.0f, 0.0f);
  return false;
}

static void perform_snake_feeding_hit(int32_t vi, bool activeButton) {
  VillagerSlot& v = g_sim.villagers[vi];
  if (v.state == VSTATE_KO || v.grabbed != 0) return;
  bool canSwallow = g_sim.scalars.snakeScale >= SWALLOW_MIN_SCALE;
  float sc = g_sim.scalars.snakeScale;

  g_sim.scalars.mouthOpen = 1.0f;

  if (!canSwallow) {
    // Small snake: Bite & Drink Blood!
    set_strike_cd(v.id, 0.42f);
    float biteDmg = activeButton ? 40.0f : (g_sim.scalars.isBoosting ? 38.0f : 32.0f);
    g_sim.scalars.hp = c_fminf(static_cast<float>(g_sim.scalars.maxHp), g_sim.scalars.hp + 12.0f);
    g_sim.scalars.stamina = c_fminf(100.0f, g_sim.scalars.stamina + 18.0f);
    g_sim.scalars.snakeScale = c_fminf(MAX_SNAKE_SCALE, g_sim.scalars.snakeScale + 0.036f);
    if (g_sim.scalars.segmentCount < MAX_SEGMENTS) {
      g_sim.scalars.segmentCount++;
    }
    push_event(EVT_BLOOD_DRINK, v.id, 0, 0, v.x, v.y + 0.85f, v.z, biteDmg, g_sim.scalars.snakeScale);

    float dx = v.x - g_sim.scalars.headX;
    float dz = v.z - g_sim.scalars.headZ;
    float kd = c_fmaxf(0.15f, c_hypotf(dx, dz));
    v.x += (dx / kd) * 0.72f;
    v.z += (dz / kd) * 0.72f;
    v.herdedTimer = 9.0f;
    hit_villager(vi, biteDmg, false, -1);
  } else {
    // Large snake: Swallow Whole!
    set_strike_cd(v.id, 0.35f);
    bool isHunter = (v.role == ROLE_SPEARMAN || v.role == ROLE_CROSSBOW);
    bool shouldSwallow = activeButton || !isHunter || v.hp <= 75.0f || sc >= 1.15f;
    if (shouldSwallow) {
      int32_t vid = v.id;
      float vx = v.x, vy = v.y, vz = v.z;
      g_sim.scalars.swallowBulgeT = 1.0f;
      g_sim.scalars.hp = c_fminf(static_cast<float>(g_sim.scalars.maxHp), g_sim.scalars.hp + 20.0f);
      g_sim.scalars.stamina = c_fminf(100.0f, g_sim.scalars.stamina + 34.0f);
      g_sim.scalars.snakeScale = c_fminf(MAX_SNAKE_SCALE, g_sim.scalars.snakeScale + 0.062f);
      hit_villager(vi, 9999.0f, false, -1);
      push_event(EVT_TAIL_DEVOUR, vid, isHunter ? 1 : 0, 0, vx, vy + 0.45f, vz, 75.0f, 0.0f);
    } else {
      float heavyBite = (g_sim.scalars.isBoosting ? 58.0f : 44.0f) * (0.85f + sc * 0.4f);
      float dx = v.x - g_sim.scalars.headX;
      float dz = v.z - g_sim.scalars.headZ;
      float kd = c_fmaxf(0.15f, c_hypotf(dx, dz));
      v.x += (dx / kd) * 0.9f;
      v.z += (dz / kd) * 0.9f;
      push_event(EVT_BLOOD_DRINK, v.id, 0, 0, v.x, v.y + 0.85f, v.z, heavyBite, sc);
      hit_villager(vi, heavyBite, false, -1);
    }
  }
}

bool sim_trigger_bite_action() {
  if (g_sim.scalars.phase != PHASE_PLAYING) return false;
  float sc = c_clampf(g_sim.scalars.snakeScale, START_SNAKE_SCALE, MAX_SNAKE_SCALE);
  float hx = g_sim.scalars.headX;
  float hy = g_sim.scalars.headY;
  float hz = g_sim.scalars.headZ;
  float fx = c_sinf(g_sim.scalars.heading);
  float fz = c_cosf(g_sim.scalars.heading);
  float lungeX = hx + fx * (0.95f * sc + 0.45f);
  float lungeZ = hz + fz * (0.95f * sc + 0.45f);

  g_sim.scalars.mouthOpen = 1.0f;

  int32_t bestIdx = -1;
  float bestD = 1e6f;
  for (int32_t vi = 0; vi < g_sim.villagerCount; vi++) {
    const VillagerSlot& v = g_sim.villagers[vi];
    if (v.state == VSTATE_KO || v.grabbed != 0) continue;
    float dHead = c_hypotf(v.x - hx, v.z - hz);
    float dLunge = c_hypotf(v.x - lungeX, v.z - lungeZ);
    float d = dHead < dLunge ? dHead : dLunge;
    float reach = HEAD_RADIUS * sc + v.radius + 1.55f;
    if (d <= reach && c_fabsf(v.y - hy) < 2.2f && d < bestD) {
      bestD = d;
      bestIdx = vi;
    }
  }

  if (bestIdx >= 0) {
    perform_snake_feeding_hit(bestIdx, true);
    return true;
  }
  return false;
}

int32_t sim_spawn_hatchling(float x, float y, float z) {
  if (g_sim.hatchlingCount >= MAX_HATCHLINGS) {
    for (int32_t i = 0; i < g_sim.hatchlingCount; i++) {
      HatchlingSlot& h = g_sim.hatchlings[i];
      h.growth = c_fminf(1.5f, h.growth + 0.28f);
      h.stage = h.growth >= 0.9f ? 3 : (h.growth >= 0.4f ? 2 : 1);
      sim_recompute_hatchling_poses(i);
    }
    push_event(EVT_HATCH, g_sim.hatchlings[0].id, 0, 0, x, y, z, 0.0f, 0.0f);
    return 0;
  }

  float yaw = normalize_angle(g_sim.scalars.heading + (g_sim.rng.next() - 0.5f) * 0.9f);
  float totalDist = 10.0f;
  int32_t hIdx = g_sim.hatchlingCount++;
  HatchlingSlot& h = g_sim.hatchlings[hIdx];
  h.id = g_sim.scalars.nextId++;
  h.stage = 1;
  h.targetVillagerId = -1;
  h.targetPreyId = -1;
  h.spineLen = 40;
  h.x = x;
  h.y = y;
  h.z = z;
  h.heading = yaw;
  h.speed = 6.0f;
  h.growth = 0.0f;
  h.biteCooldown = 0.25f;
  h.totalDist = totalDist;
  h.pad0 = h.pad1 = 0.0f;

  float* sp = g_sim.hatchlingSpines[hIdx];
  for (int32_t i = 0; i < 40; i++) {
    float back = static_cast<float>(i) * 0.14f;
    sp[i * 4] = x - c_sinf(yaw) * back;
    sp[i * 4 + 1] = y;
    sp[i * 4 + 2] = z - c_cosf(yaw) * back;
    sp[i * 4 + 3] = totalDist - back;
  }
  sim_recompute_hatchling_poses(hIdx);
  g_sim.scalars.totalHatched++;
  push_event(EVT_HATCH, h.id, 0, 0, x, y, z, 0.0f, 0.0f);
  return hIdx;
}

void sim_damage_snake(float amount, float sourceX, float sourceY, float sourceZ) {
  if (g_sim.scalars.phase != PHASE_PLAYING || g_sim.scalars.invulnTimer > 0.0f) return;
  float dmg = c_fmaxf(1.0f, c_floorf(amount + 0.5f));
  g_sim.scalars.hp = c_fmaxf(0.0f, g_sim.scalars.hp - dmg);
  g_sim.scalars.invulnTimer = 0.72f;
  g_sim.scalars.outOfCombatTimer = 0.0f;

  float dx = g_sim.scalars.headX - sourceX;
  float dz = g_sim.scalars.headZ - sourceZ;
  float d = c_hypotf(dx, dz);
  if (d > 1e-4f) {
    float pushX = g_sim.scalars.headX + (dx / d) * 0.4f;
    float pushZ = g_sim.scalars.headZ + (dz / d) * 0.4f;
    float dummyNx = 0.0f, dummyNz = 0.0f;
    float sc = c_clampf(g_sim.scalars.snakeScale, START_SNAKE_SCALE, MAX_SNAKE_SCALE);
    resolve_solid_point(pushX, pushZ, g_sim.scalars.headY, HEAD_RADIUS * sc, dummyNx, dummyNz);
    g_sim.scalars.headX = pushX;
    g_sim.scalars.headZ = pushZ;
  }

  push_event(EVT_SNAKE_HURT, static_cast<int32_t>(dmg), 0, 0, sourceX, sourceY, sourceZ, dmg, 0.0f);

  if (g_sim.scalars.hp <= 0.0f) {
    g_sim.scalars.deathReason = DEATH_HUNTER;
    if (g_sim.scalars.score > g_sim.scalars.bestScore) {
      g_sim.scalars.bestScore = g_sim.scalars.score;
    }
    push_event(EVT_CRASH, DEATH_HUNTER, 0, 0, g_sim.scalars.headX, 0.0f, g_sim.scalars.headZ, 0.0f, 0.0f);
    sim_set_phase(PHASE_GAMEOVER);
  }
}

static void hit_villager(int32_t vIdx, float damage, bool byHatchling, int32_t attackerVillageId) {
  VillagerSlot& v = g_sim.villagers[vIdx];
  if (v.state == VSTATE_KO) return;
  v.hp -= damage;
  v.hitFlash = 1.0f;
  if (attackerVillageId < 0) {
    g_sim.scalars.raidHeat += 0.25f;
    g_sim.scalars.threatLevel = get_village_threat_level();
  }

  bool isHunter = (v.role == ROLE_SPEARMAN || v.role == ROLE_CROSSBOW);
  if (isHunter && v.state == VSTATE_WINDUP && damage >= 30.0f) {
    v.state = VSTATE_RECOVER;
    v.stateTimer = 0.45f;
  }

  if (v.hp <= 0.0f) {
    v.hp = 0.0f;
    v.state = VSTATE_KO;
    v.koTimer = 0.48f;

    if (attackerVillageId < 0) {
      g_sim.scalars.kills++;
      if (!byHatchling) {
        g_sim.scalars.feastCount++;
        g_sim.scalars.powerTier = compute_power_tier(g_sim.scalars.feastCount);
      }

      g_sim.scalars.raidHeat += isHunter ? (v.isElite ? 2.8f : 1.8f) : 1.15f;
      g_sim.scalars.threatLevel = get_village_threat_level();

      int32_t vTierExtra = v.tier > 1 ? v.tier - 1 : 0;
      float basePts = isHunter ? (110.0f + static_cast<float>(vTierExtra) * 25.0f + (v.isElite ? 65.0f : 0.0f)) : 70.0f;
      float awarded = basePts * static_cast<float>(g_sim.scalars.combo);
      g_sim.scalars.score += awarded;
      if (g_sim.scalars.score > g_sim.scalars.bestScore) {
        g_sim.scalars.bestScore = g_sim.scalars.score;
      }
      g_sim.scalars.combo = g_sim.scalars.combo < 8 ? g_sim.scalars.combo + 1 : 8;
      g_sim.scalars.comboTimer = COMBO_DURATION;
      int32_t segGrow = isHunter ? 4 : 3;
      g_sim.scalars.segmentCount = g_sim.scalars.segmentCount + segGrow < MAX_SEGMENTS
          ? g_sim.scalars.segmentCount + segGrow : MAX_SEGMENTS;
      g_sim.scalars.snakeScale = c_fminf(MAX_SNAKE_SCALE, g_sim.scalars.snakeScale + (isHunter ? 0.056f : 0.045f));
      float hpHeal = v.isElite ? 26.0f : (isHunter ? 18.0f : 14.0f);
      g_sim.scalars.hp = c_fminf(static_cast<float>(g_sim.scalars.maxHp), g_sim.scalars.hp + hpHeal);
      g_sim.scalars.stamina = c_fminf(100.0f, g_sim.scalars.stamina + 35.0f);

      if (isHunter) {
        sim_spawn_prey(1, PREY_EGG, 1, v.x, v.z, 1, v.y);
      }
      push_event(EVT_VILLAGER_HIT, v.id, 1, byHatchling ? 1 : 0, v.x, v.y, v.z, 0.0f, 0.0f);
    } else {
      // Killed by a rival village hunter during village warfare!
      push_event(EVT_VILLAGER_HIT, v.id, 1, 2, v.x, v.y, v.z, 0.0f, 0.0f);
    }
  } else {
    push_event(EVT_VILLAGER_HIT, v.id, 0, byHatchling ? 1 : 0, v.x, v.y, v.z, 0.0f, 0.0f);
  }
}

static void move_human_actor(VillagerSlot& actor, float desiredHeading, float speed, float dt) {
  float turnDiff = normalize_angle(desiredHeading - actor.heading);
  float signD = turnDiff >= 0.0f ? 1.0f : -1.0f;
  actor.heading = normalize_angle(actor.heading + signD * c_fminf(c_fabsf(turnDiff), 7.5f * dt));
  actor.speed = speed;

  if (speed <= 0.05f) {
    actor.vx = 0.0f;
    actor.vz = 0.0f;
    return;
  }

  float nextX = actor.x + c_sinf(actor.heading) * speed * dt;
  float nextZ = actor.z + c_cosf(actor.heading) * speed * dt;

  float nx = 0.0f, nz = 0.0f;
  if (resolve_solid_point(nextX, nextZ, actor.y, actor.radius, nx, nz)) {
    if (actor.state == VSTATE_PATROL || actor.state == VSTATE_FLEEING) {
      actor.heading = normalize_angle(c_atan2f(nx, nz) + 0.45f);
    }
  }

  float moved = c_hypotf(nextX - actor.x, nextZ - actor.z);
  float invDt = 1.0f / c_fmaxf(dt, 1e-4f);
  actor.vx = (nextX - actor.x) * invDt;
  actor.vz = (nextZ - actor.z) * invDt;
  actor.x = nextX;
  actor.z = nextZ;

  float targetY = surface_height_at(actor.x, actor.z, actor.y);
  if (targetY < actor.y - 0.12f) {
    actor.y = c_fmaxf(targetY, actor.y - 7.5f * dt);
  } else {
    actor.y = targetY;
  }
  actor.gaitPhase += moved * 3.1f;
}

static bool find_nearest_building_spot(
    float x,
    float z,
    int32_t& outBId,
    float& outDoorX,
    float& outDoorZ,
    float& outHideX,
    float& outHideZ) {
  int32_t bestIdx = -1;
  float bestDist = 1e9f;
  for (int32_t i = 0; i < g_building_count; i++) {
    const EnterableBuilding& b = g_buildings[i];
    if (b.kind == BLDG_RUIN_TOWER) continue;
    float d = c_hypotf(b.x - x, b.z - z);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return false;
  const EnterableBuilding& best = g_buildings[bestIdx];
  outBId = best.id;
  building_local_to_world(best, 0.0f, best.kind == BLDG_MANOR ? 4.6f : 4.8f, outDoorX, outDoorZ);
  building_local_to_world(best, best.interiorSpotX, best.interiorSpotZ, outHideX, outHideZ);
  return true;
}

static void step_villagers(float dt, bool reactToSnake) {
  DifficultyParams diff = get_diff_params(g_sim.scalars.difficulty);
  if (reactToSnake && is_inside_village(g_sim.scalars.headX, g_sim.scalars.headZ, 0.0f)) {
    g_sim.scalars.raidHeat += 0.14f * dt;
  }
  int32_t tier = get_village_threat_level();
  g_sim.scalars.threatLevel = tier;
  int32_t maxAttackersAllowed = MAX_ACTIVE_ATTACKERS + (tier / 2);
  if (maxAttackersAllowed > 8) maxAttackersAllowed = 8;

  int32_t activeAttackers = 0;
  for (int32_t i = 0; i < g_sim.villagerCount; i++) {
    int32_t st = g_sim.villagers[i].state;
    if (st == VSTATE_WINDUP || st == VSTATE_ATTACK) activeAttackers++;
  }

  g_sim.rivalEventCd = c_fmaxf(0.0f, g_sim.rivalEventCd - dt);
  bool anyAlert = false;
  bool clashThisFrame = false;
  float clashCenterX = 0.0f, clashCenterZ = 0.0f;
  bool hasAlarmSpot = false;
  float alarmX = 0.0f, alarmZ = 0.0f;

  for (int32_t i = g_sim.villagerCount - 1; i >= 0; i--) {
    VillagerSlot& v = g_sim.villagers[i];
    v.hitFlash = c_fmaxf(0.0f, v.hitFlash - dt * 4.5f);
    v.attackCooldown = c_fmaxf(0.0f, v.attackCooldown - dt);
    v.herdedTimer = c_fmaxf(0.0f, v.herdedTimer - dt);

    if (v.state == VSTATE_KO) {
      v.grabbed = 0;
      v.poisonTimer = 0.0f;
      v.stunTimer = 0.0f;
      v.targetVillagerId = -1;
      v.vx = v.vz = v.speed = 0.0f;
      v.koTimer -= dt;
      if (v.koTimer <= 0.0f) {
        g_sim.villagers[i] = g_sim.villagers[--g_sim.villagerCount];
      }
      continue;
    }

    if (v.grabbed != 0) {
      anyAlert = true;
      v.vx = v.vz = v.speed = 0.0f;
      v.heading = normalize_angle(v.heading + 14.0f * dt);
      if (g_sim.scalars.grabStage == 1 && g_sim.scalars.grabTargetId == v.id) {
        float prog = c_clampf(1.0f - g_sim.scalars.grabTimer / 0.52f, 0.0f, 1.0f);
        float destX = g_sim.scalars.headX;
        float destY = g_sim.scalars.headY + 0.35f;
        float destZ = g_sim.scalars.headZ;
        v.x = g_sim.scalars.grabOriginX + (destX - g_sim.scalars.grabOriginX) * prog;
        v.z = g_sim.scalars.grabOriginZ + (destZ - g_sim.scalars.grabOriginZ) * prog;
        v.y = g_sim.scalars.grabOriginY + (destY - g_sim.scalars.grabOriginY) * prog +
            c_sinf(prog * PI) * 1.15f;

        if (g_sim.scalars.grabTimer <= 0.0f) {
          v.grabbed = 0;
          bool isHunter = (v.role == ROLE_SPEARMAN || v.role == ROLE_CROSSBOW);
          g_sim.scalars.grabStage = 2;
          g_sim.scalars.grabTargetId = -1;
          g_sim.scalars.mouthOpen = 1.0f;
          g_sim.scalars.swallowBulgeT = 1.0f;

          float devourBonus = 60.0f * static_cast<float>(g_sim.scalars.combo);
          g_sim.scalars.score += devourBonus;
          if (g_sim.scalars.score > g_sim.scalars.bestScore) {
            g_sim.scalars.bestScore = g_sim.scalars.score;
          }
          g_sim.scalars.hp = c_fminf(static_cast<float>(g_sim.scalars.maxHp), g_sim.scalars.hp + 16.0f);
          g_sim.scalars.stamina = c_fminf(100.0f, g_sim.scalars.stamina + 28.0f);
          g_sim.scalars.segmentCount = g_sim.scalars.segmentCount + 2 < MAX_SEGMENTS
              ? g_sim.scalars.segmentCount + 2 : MAX_SEGMENTS;
          g_sim.scalars.snakeScale = c_fminf(MAX_SNAKE_SCALE, g_sim.scalars.snakeScale + 0.048f);
          int32_t devouredId = v.id;
          hit_villager(i, 9999.0f, false, -1);
          push_event(EVT_TAIL_DEVOUR, devouredId, isHunter ? 1 : 0, 0,
              g_sim.scalars.headX, g_sim.scalars.headY + 0.3f, g_sim.scalars.headZ,
              devourBonus, 0.0f);
        }
      } else {
        v.grabbed = 0;
      }
      continue;
    }

    if (v.poisonTimer > 0.0f) {
      v.poisonTimer = c_fmaxf(0.0f, v.poisonTimer - dt);
      v.hp -= 6.5f * dt;
      if (v.hp <= 0.0f) {
        hit_villager(i, 9999.0f, false, -1);
        continue;
      }
    }

    if (v.stunTimer > 0.0f) {
      v.stunTimer = c_fmaxf(0.0f, v.stunTimer - dt);
      v.vx = v.vz = v.speed = 0.0f;
      if (v.state == VSTATE_WINDUP || v.state == VSTATE_ATTACK) {
        v.state = VSTATE_RECOVER;
        v.stateTimer = 0.4f;
      }
      continue;
    }

    // Validate & discover rival village enemies nearby ("ఒక ఊరి మనుషుల్ని ఇంకొక ఊరులోకి తీసుకువెళ్తే ఊర్ల మధ్య పెద్ద గొడవే")
    int32_t rivalIdx = -1;
    float rivalDist = 1e6f;
    if (v.targetVillagerId >= 0) {
      for (int32_t rj = 0; rj < g_sim.villagerCount; rj++) {
        if (rj == i) continue;
        const VillagerSlot& r2 = g_sim.villagers[rj];
        if (r2.id == v.targetVillagerId && r2.state != VSTATE_KO && r2.grabbed == 0) {
          float rd = c_hypotf(r2.x - v.x, r2.z - v.z);
          if (rd < 44.0f) {
            rivalIdx = rj;
            rivalDist = rd;
          }
          break;
        }
      }
      if (rivalIdx < 0) v.targetVillagerId = -1;
    }

    int32_t curTown = find_village_at(v.x, v.z, 8.0f);
    bool inForeignTown = (curTown >= 0 && curTown != v.homeVillageId);
    float detectRivalRad = inForeignTown ? 36.0f : 26.0f;

    int32_t nearestRivalIdx = -1;
    float nearestRivalD = detectRivalRad;
    for (int32_t rj = 0; rj < g_sim.villagerCount; rj++) {
      if (rj == i) continue;
      const VillagerSlot& r2 = g_sim.villagers[rj];
      if (r2.state == VSTATE_KO || r2.grabbed != 0) continue;
      if (r2.homeVillageId == v.homeVillageId) continue;
      float d = c_hypotf(r2.x - v.x, r2.z - v.z);
      if (d < nearestRivalD) {
        nearestRivalD = d;
        nearestRivalIdx = rj;
      }
    }

    if (nearestRivalIdx >= 0) {
      clashThisFrame = true;
      clashCenterX = v.x;
      clashCenterZ = v.z;
      if (!hasAlarmSpot) {
        hasAlarmSpot = true;
        alarmX = v.x;
        alarmZ = v.z;
      }
      if ((v.role == ROLE_SPEARMAN || v.role == ROLE_CROSSBOW) && (rivalIdx < 0 || nearestRivalD + 3.0f < rivalDist)) {
        rivalIdx = nearestRivalIdx;
        rivalDist = nearestRivalD;
        v.targetVillagerId = g_sim.villagers[rivalIdx].id;
        v.herdedTimer = 10.0f;
        if (v.state == VSTATE_PATROL) v.state = VSTATE_PURSUE;
      }
    }

    float threatX = g_sim.scalars.headX;
    float threatZ = g_sim.scalars.headZ;
    float threatDist = c_hypotf(v.x - threatX, v.z - threatZ);
    if (g_sim.scalars.stealthTimer > 0.0f && threatDist > 4.5f) {
      threatDist = 100.0f;
    }
    if (nearestRivalIdx >= 0 && (v.role == ROLE_FLEE || v.role == ROLE_HIDE)) {
      const VillagerSlot& rv = g_sim.villagers[nearestRivalIdx];
      if (nearestRivalD < threatDist) {
        threatDist = nearestRivalD;
        threatX = rv.x;
        threatZ = rv.z;
      }
    }
    float poisonSlow = v.poisonTimer > 0.0f ? 0.62f : 1.0f;
    for (int32_t hi = 0; hi < g_sim.hatchlingCount; hi++) {
      const HatchlingSlot& h = g_sim.hatchlings[hi];
      float hd = c_hypotf(v.x - h.x, v.z - h.z);
      if (hd < threatDist) {
        threatDist = hd;
        threatX = h.x;
        threatZ = h.z;
      }
    }

    float maxHomeRadius = (v.herdedTimer > 0.0f || v.targetVillagerId >= 0) ? 225.0f : 12.0f;

    if (v.role == ROLE_FLEE) {
      if ((reactToSnake || nearestRivalIdx >= 0) && threatDist < 19.5f) {
        v.state = VSTATE_FLEEING;
        v.stateTimer = 3.2f;
        v.herdedTimer = 9.0f;
        if (!hasAlarmSpot) {
          hasAlarmSpot = true;
          alarmX = v.x;
          alarmZ = v.z;
        }
      } else if (v.state == VSTATE_FLEEING) {
        v.stateTimer -= dt;
        if (v.stateTimer <= 0.0f && threatDist > 23.0f) {
          v.state = VSTATE_PATROL;
        }
      }

      if (v.state == VSTATE_FLEEING) {
        float fx = v.x - threatX;
        float fz = v.z - threatZ;
        float fd = c_fmaxf(0.1f, c_hypotf(fx, fz));
        fx /= fd;
        fz /= fd;
        // Subtle directional steer toward nearest neighboring village when herded far from home
        if (c_hypotf(v.x - v.homeX, v.z - v.homeZ) > 32.0f) {
          int32_t otherV = -1;
          float bestOD = 1e9f;
          for (int32_t k = 0; k < NUM_VILLAGES; k++) {
            if (k == v.homeVillageId) continue;
            float vd = c_hypotf(g_villages[k].centerX - v.x, g_villages[k].centerZ - v.z);
            if (vd < bestOD) { bestOD = vd; otherV = k; }
          }
          if (otherV >= 0) {
            float tx = g_villages[otherV].centerX - v.x;
            float tz = g_villages[otherV].centerZ - v.z;
            float td = c_fmaxf(0.1f, bestOD);
            fx += (tx / td) * 0.34f;
            fz += (tz / td) * 0.34f;
          }
        }
        move_human_actor(v, c_atan2f(fx, fz), 5.3f * poisonSlow, dt);
      } else {
        v.stateTimer -= dt;
        float distHome = c_hypotf(v.homeX - v.x, v.homeZ - v.z);
        float targetH = v.heading;
        if (distHome > maxHomeRadius) {
          targetH = c_atan2f(v.homeX - v.x, v.homeZ - v.z);
        } else if (v.stateTimer <= 0.0f) {
          v.stateTimer = 2.0f + g_sim.rng.next() * 2.5f;
          targetH = normalize_angle(v.heading + (g_sim.rng.next() - 0.5f) * 2.2f);
        }
        bool isStrolling = c_fmodf_pos(g_sim.scalars.elapsedSeconds * 0.4f + v.phase, 4.0f) < 2.5f;
        move_human_actor(v, targetH, isStrolling ? 1.55f : 0.0f, dt);
      }
    } else if (v.role == ROLE_HIDE) {
      int32_t sBId = -1;
      float doorX = 0.0f, doorZ = 0.0f, hideX = 0.0f, hideZ = 0.0f;
      bool hasShelter = find_nearest_building_spot(v.x, v.z, sBId, doorX, doorZ, hideX, hideZ);
      if ((reactToSnake || nearestRivalIdx >= 0) && threatDist < 19.5f && hasShelter) {
        if (v.state != VSTATE_HIDING) {
          v.state = VSTATE_SEEKING_SHELTER;
          v.targetBuildingId = sBId;
        }
        v.stateTimer = 4.0f;
        v.herdedTimer = 9.0f;
        if (!hasAlarmSpot) {
          hasAlarmSpot = true;
          alarmX = v.x;
          alarmZ = v.z;
        }
      } else if (v.state == VSTATE_HIDING || v.state == VSTATE_SEEKING_SHELTER) {
        v.stateTimer -= dt;
        if (v.stateTimer <= 0.0f && threatDist > 24.0f) {
          v.state = VSTATE_PATROL;
          v.targetBuildingId = -1;
        }
      }

      if (v.state == VSTATE_SEEKING_SHELTER && hasShelter) {
        float dHide = c_hypotf(hideX - v.x, hideZ - v.z);
        BuildingLocResult loc = get_building_at_position(v.x, v.z, v.y);
        if (dHide < 1.8f || (loc.isIndoors && loc.buildingId == sBId)) {
          v.state = VSTATE_HIDING;
          v.vx = v.vz = v.speed = 0.0f;
          v.heading = c_atan2f(threatX - v.x, threatZ - v.z);
        } else {
          float dDoor = c_hypotf(doorX - v.x, doorZ - v.z);
          float tx = (!loc.isIndoors && dDoor > 2.2f) ? doorX : hideX;
          float tz = (!loc.isIndoors && dDoor > 2.2f) ? doorZ : hideZ;
          move_human_actor(v, c_atan2f(tx - v.x, tz - v.z), 4.7f, dt);
        }
      } else if (v.state == VSTATE_HIDING) {
        v.vx = v.vz = v.speed = 0.0f;
        v.heading = c_atan2f(threatX - v.x, threatZ - v.z);
      } else {
        v.stateTimer -= dt;
        float distHome = c_hypotf(v.homeX - v.x, v.homeZ - v.z);
        float targetH = v.heading;
        if (distHome > maxHomeRadius) {
          targetH = c_atan2f(v.homeX - v.x, v.homeZ - v.z);
        } else if (v.stateTimer <= 0.0f) {
          v.stateTimer = 2.2f + g_sim.rng.next() * 2.2f;
          targetH = normalize_angle(v.heading + (g_sim.rng.next() - 0.5f) * 2.0f);
        }
        bool isStrolling = c_fmodf_pos(g_sim.scalars.elapsedSeconds * 0.35f + v.phase, 4.4f) < 2.4f;
        move_human_actor(v, targetH, isStrolling ? 1.45f : 0.0f, dt);
      }
    } else {
      int32_t vTier = tier > v.tier ? tier : v.tier;
      float eliteBonus = v.isElite ? 1.0f : 0.0f;
      float hunterTierDmgMult = 1.0f + c_fminf(0.9f, static_cast<float>(vTier - 1) * 0.14f) + eliteBonus * 0.35f;
      float hunterSpeedMult = 1.0f + c_fminf(0.38f, static_cast<float>(vTier - 1) * 0.065f) + eliteBonus * 0.1f;

      float sightRange = (v.role == ROLE_CROSSBOW ? 28.0f : 25.0f) + c_fminf(16.0f, static_cast<float>(vTier - 1) * 3.0f);
      float engageRange = v.role == ROLE_CROSSBOW ? 19.0f : (3.1f + eliteBonus * 0.25f);
      float villageMobRange = (g_sim.scalars.activeVillageId == v.homeVillageId)
          ? 34.0f + c_fminf(18.0f, static_cast<float>(vTier - 1) * 3.5f) : sightRange;

      if (!reactToSnake && rivalIdx < 0) {
        float patrolYaw = g_sim.scalars.elapsedSeconds * 0.35f + v.phase;
        float tx = v.homeX + c_sinf(patrolYaw) * 4.5f;
        float tz = v.homeZ + c_cosf(patrolYaw) * 4.5f;
        move_human_actor(v, c_atan2f(tx - v.x, tz - v.z), 1.6f, dt);
        continue;
      }

      // Target rival villager FIRST if fighting another village, otherwise target player snake!
      bool fightingRival = (rivalIdx >= 0 && rivalIdx < g_sim.villagerCount && i != rivalIdx);
      float targetX = fightingRival ? g_sim.villagers[rivalIdx].x : g_sim.scalars.headX;
      float targetY = fightingRival ? g_sim.villagers[rivalIdx].y : g_sim.scalars.headY;
      float targetZ = fightingRival ? g_sim.villagers[rivalIdx].z : g_sim.scalars.headZ;
      float targetDist = c_hypotf(targetX - v.x, targetZ - v.z);
      bool playerStealthed = !fightingRival && g_sim.scalars.stealthTimer > 0.0f && targetDist > 4.5f;

      bool heardAlarm = !playerStealthed && hasAlarmSpot &&
          c_hypotf(alarmX - v.x, alarmZ - v.z) < 32.0f + static_cast<float>(vTier) * 2.0f;

      if (v.state == VSTATE_PATROL) {
        if (fightingRival || (!playerStealthed && targetDist < villageMobRange) || heardAlarm) {
          v.state = VSTATE_PURSUE;
          v.herdedTimer = 9.0f;
        } else {
          float distHome = c_hypotf(v.homeX - v.x, v.homeZ - v.z);
          float patrolH = v.heading;
          v.stateTimer -= dt;
          if (distHome > maxHomeRadius) {
            patrolH = c_atan2f(v.homeX - v.x, v.homeZ - v.z);
          } else if (v.stateTimer <= 0.0f) {
            v.stateTimer = 2.0f + g_sim.rng.next() * 2.0f;
            patrolH = normalize_angle(v.heading + (g_sim.rng.next() - 0.5f) * 1.9f);
          }
          move_human_actor(v, patrolH, 1.95f * poisonSlow, dt);
        }
      } else if (v.state == VSTATE_PURSUE) {
        if (!fightingRival) anyAlert = true;
        v.herdedTimer = 8.0f;
        if (!fightingRival && (playerStealthed || targetDist > 54.0f + static_cast<float>(vTier) * 3.0f)) {
          v.state = VSTATE_PATROL;
          continue;
        }
        float toTarget = c_atan2f(targetX - v.x, targetZ - v.z);

        if (targetDist <= engageRange && v.attackCooldown <= 0.0f && activeAttackers < maxAttackersAllowed) {
          v.state = VSTATE_WINDUP;
          float baseWindup = v.role == ROLE_CROSSBOW ? 0.62f : 0.52f;
          v.stateTimer = c_fmaxf(0.32f, baseWindup - c_fminf(0.18f, static_cast<float>(vTier - 1) * 0.032f));
          v.heading = toTarget;
          v.vx = v.vz = v.speed = 0.0f;
          activeAttackers++;
          if (!fightingRival) {
            push_event(EVT_HUNTER_TELEGRAPH, v.id, 0, 0, v.x, v.y, v.z, 0.0f, 0.0f);
          }
        } else if (v.role == ROLE_CROSSBOW && targetDist < 7.5f) {
          move_human_actor(v, normalize_angle(toTarget + PI), 3.15f * hunterSpeedMult * poisonSlow, dt);
          v.heading = toTarget;
        } else {
          float chaseSpeed =
              (v.role == ROLE_SPEARMAN ? 4.45f : 3.55f) *
              (0.92f + diff.speedMult * 0.08f) *
              hunterSpeedMult * poisonSlow;
          move_human_actor(v, toTarget, chaseSpeed, dt);
        }
      } else if (v.state == VSTATE_WINDUP) {
        if (!fightingRival) anyAlert = true;
        v.vx = v.vz = v.speed = 0.0f;
        float toTarget = c_atan2f(targetX - v.x, targetZ - v.z);
        float diffH = normalize_angle(toTarget - v.heading);
        v.heading = normalize_angle(v.heading + diffH * c_fminf(1.0f, 5.5f * dt));

        v.stateTimer -= dt;
        if (v.stateTimer <= 0.0f) {
          v.state = VSTATE_ATTACK;
          v.stateTimer = 0.24f;
          if (v.role == ROLE_CROSSBOW) {
            float dx = targetX - v.x;
            float dz = targetZ - v.z;
            float dy = targetY + (fightingRival ? 0.95f : 0.35f) - (v.y + 1.15f);
            float horiz = c_fmaxf(0.1f, c_hypotf(dx, dz));
            float boltSpeed = 16.5f + c_fminf(4.5f, static_cast<float>(vTier - 1) * 0.9f);
            float baseYaw = c_atan2f(dx, dz);
            bool spread = (vTier >= 4 || v.isElite != 0);
            int32_t boltCount = spread ? 2 : 1;
            float offsets[2] = {spread ? -0.09f : 0.0f, 0.09f};
            float flatDist = c_hypotf3(dx, dy, dz);
            if (flatDist < 1e-4f) flatDist = 1.0f;
            float pitchRatio = dy / flatDist;
            float horizScale = c_sqrtf(c_fmaxf(0.05f, 1.0f - pitchRatio * pitchRatio));
            int32_t dmg = static_cast<int32_t>(12.0f * diff.hunterDmgMult * hunterTierDmgMult + 0.5f);
            for (int32_t bi = 0; bi < boltCount && g_sim.projectileCount < MAX_PROJ_POOL; bi++) {
              float yaw = baseYaw + offsets[bi];
              ProjectileSlot& pr = g_sim.projectiles[g_sim.projectileCount++];
              pr.id = g_sim.scalars.nextId++;
              pr.damage = dmg;
              pr.x = v.x + (dx / horiz) * 0.75f;
              pr.y = v.y + 1.15f;
              pr.z = v.z + (dz / horiz) * 0.75f;
              pr.vx = c_sinf(yaw) * boltSpeed * horizScale;
              pr.vy = pitchRatio * boltSpeed;
              pr.vz = c_cosf(yaw) * boltSpeed * horizScale;
              pr.yaw = yaw;
              pr.life = 2.2f;
              pr.kind = PROJ_BOLT;
              pr.radius = 0.14f;
              pr.ownerVillageId = v.homeVillageId;
              pr.padP1 = pr.padP2 = pr.padP3 = 0;
            }
          } else {
            move_human_actor(v, v.heading, 6.2f * hunterSpeedMult, dt);
            float strikeX = v.x + c_sinf(v.heading) * 1.45f;
            float strikeZ = v.z + c_cosf(v.heading) * 1.45f;
            if (fightingRival) {
              float hitD = c_hypotf(targetX - strikeX, targetZ - strikeZ);
              if (hitD < 1.85f && c_fabsf(targetY - v.y) < 1.8f) {
                hit_villager(rivalIdx, 18.0f * hunterTierDmgMult, false, v.homeVillageId);
              }
            } else {
              float hitD = c_hypotf(g_sim.scalars.headX - strikeX, g_sim.scalars.headZ - strikeZ);
              if (hitD < 1.55f && c_fabsf(g_sim.scalars.headY - v.y) < 1.6f) {
                sim_damage_snake(15.0f * diff.hunterDmgMult * hunterTierDmgMult, v.x, v.y, v.z);
              }
            }
          }
        }
      } else if (v.state == VSTATE_ATTACK) {
        if (!fightingRival) anyAlert = true;
        if (v.role == ROLE_SPEARMAN) {
          move_human_actor(v, v.heading, 3.2f * hunterSpeedMult, dt);
          float strikeX = v.x + c_sinf(v.heading) * 1.35f;
          float strikeZ = v.z + c_cosf(v.heading) * 1.35f;
          if (fightingRival) {
            float hitD = c_hypotf(targetX - strikeX, targetZ - strikeZ);
            if (hitD < 1.6f && c_fabsf(targetY - v.y) < 1.8f) {
              hit_villager(rivalIdx, 12.0f * hunterTierDmgMult, false, v.homeVillageId);
            }
          } else {
            float hitD = c_hypotf(g_sim.scalars.headX - strikeX, g_sim.scalars.headZ - strikeZ);
            if (hitD < 1.35f && c_fabsf(g_sim.scalars.headY - v.y) < 1.6f) {
              sim_damage_snake(14.0f * diff.hunterDmgMult * hunterTierDmgMult, v.x, v.y, v.z);
            }
          }
        } else {
          v.vx = v.vz = v.speed = 0.0f;
        }
        v.stateTimer -= dt;
        if (v.stateTimer <= 0.0f) {
          v.state = VSTATE_RECOVER;
          float tierFast = c_fminf(0.45f, static_cast<float>(vTier - 1) * 0.085f);
          v.stateTimer = c_fmaxf(0.38f, (v.role == ROLE_CROSSBOW ? 1.25f : 0.75f) - tierFast);
          v.attackCooldown = c_fmaxf(0.55f, (v.role == ROLE_CROSSBOW ? 1.8f : 1.05f) - tierFast);
        }
      } else if (v.state == VSTATE_RECOVER) {
        if (!fightingRival) anyAlert = true;
        v.vx = v.vz = v.speed = 0.0f;
        v.stateTimer -= dt;
        if (v.stateTimer <= 0.0f) {
          v.state = VSTATE_PURSUE;
        }
      }
    }
  }

  if (clashThisFrame && g_sim.scalars.rivalClashActive == 0 && g_sim.rivalEventCd <= 0.0f) {
    g_sim.rivalEventCd = 5.5f;
    push_event(EVT_RIVAL_CLASH, 1, 0, 0, clashCenterX, ground_height_at(clashCenterX, clashCenterZ), clashCenterZ, 0.0f, 0.0f);
  }
  g_sim.scalars.rivalClashActive = clashThisFrame ? 1 : 0;
  g_sim.scalars.hunterAlert = anyAlert ? 1 : 0;

  if (reactToSnake) {
    g_sim.scalars.villagerReinforceTimer -= dt;
    if (g_sim.scalars.villagerReinforceTimer <= 0.0f) {
      g_sim.scalars.villagerReinforceTimer = c_fmaxf(4.2f, 9.5f - static_cast<float>(tier - 1) * 1.0f);
      int32_t aliveHunters = 0;
      int32_t aliveCivs = 0;
      for (int32_t i = 0; i < g_sim.villagerCount; i++) {
        const VillagerSlot& v = g_sim.villagers[i];
        if (v.state == VSTATE_KO) continue;
        if (v.role == ROLE_SPEARMAN || v.role == ROLE_CROSSBOW) aliveHunters++;
        else aliveCivs++;
      }

      int32_t nearVid = nearest_village_id(g_sim.scalars.headX, g_sim.scalars.headZ);
      const VillageDef& vg = g_villages[nearVid];
      float gxList[4] = {vg.centerX, vg.centerX - vg.halfW + 1.5f, vg.centerX + vg.halfW - 1.5f, vg.centerX};
      float gzList[4] = {vg.centerZ - vg.halfD + 1.5f, vg.centerZ, vg.centerZ, vg.centerZ + vg.halfD - 1.5f};

      int32_t maxHuntersScaled = diff.maxHunters + (tier - 1) * 2;
      if (maxHuntersScaled > 36) maxHuntersScaled = 36;

      if (aliveHunters < maxHuntersScaled) {
        int32_t gi = static_cast<int32_t>(g_sim.rng.next() * 4.0f) & 3;
        float gx = gxList[gi];
        float gz = gzList[gi];
        if (c_hypotf(gx - g_sim.scalars.headX, gz - g_sim.scalars.headZ) > 14.0f) {
          float eliteChance = tier >= 3 ? c_fminf(0.65f, 0.28f + static_cast<float>(tier - 3) * 0.14f) : 0.0f;
          int32_t isElite = g_sim.rng.next() < eliteChance ? 1 : 0;
          int32_t role = g_sim.rng.next() >= 0.6f ? ROLE_CROSSBOW : ROLE_SPEARMAN;
          int32_t nv = sim_spawn_villager(
              role,
              gx + (g_sim.rng.next() - 0.5f) * 3.0f,
              gz + (g_sim.rng.next() - 0.5f) * 3.0f,
              tier,
              isElite,
              nearVid);
          if (nv >= 0) {
            g_sim.villagers[nv].state = VSTATE_PURSUE;
          }
        }
      } else if (aliveCivs < 16) {
        int32_t randVid = static_cast<int32_t>(g_sim.rng.next() * static_cast<float>(NUM_VILLAGES)) % NUM_VILLAGES;
        const VillageDef& rv = g_villages[randVid];
        if (c_hypotf(rv.centerX - g_sim.scalars.headX, rv.centerZ - g_sim.scalars.headZ) > 18.0f) {
          sim_spawn_villager(
              g_sim.rng.next() < 0.55f ? ROLE_FLEE : ROLE_HIDE,
              rv.centerX + (g_sim.rng.next() - 0.5f) * 16.0f,
              rv.centerZ + (g_sim.rng.next() - 0.5f) * 12.0f,
              1,
              0,
              randVid);
        }
      }
    }
  }
}

static void step_projectiles(float dt) {
  float sc = c_clampf(g_sim.scalars.snakeScale, START_SNAKE_SCALE, MAX_SNAKE_SCALE);
  for (int32_t i = g_sim.projectileCount - 1; i >= 0; i--) {
    ProjectileSlot& p = g_sim.projectiles[i];
    p.life -= dt;
    if (p.life <= 0.0f) {
      g_sim.projectiles[i] = g_sim.projectiles[--g_sim.projectileCount];
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    float grav = p.kind == PROJ_BOLT ? 2.2f : (p.kind == PROJ_VENOM ? 1.5f : 0.45f);
    p.vy -= grav * dt;

    float surfY = surface_height_at(p.x, p.z, p.y);
    if (p.y <= surfY + 0.08f) {
      g_sim.projectiles[i] = g_sim.projectiles[--g_sim.projectileCount];
      continue;
    }
    CollisionResult wallHit = resolve_building_wall_collision(p.x, p.y, p.z, 0.14f);
    if (wallHit.collided) {
      g_sim.projectiles[i] = g_sim.projectiles[--g_sim.projectileCount];
      continue;
    }

    if (p.kind == PROJ_BOLT) {
      bool hitSnake = c_hypotf(p.x - g_sim.scalars.headX, p.z - g_sim.scalars.headZ) < HEAD_RADIUS * sc + 0.28f &&
          c_fabsf(p.y - (g_sim.scalars.headY + 0.3f * sc)) < 0.85f;
      if (!hitSnake) {
        int32_t checkSegs = g_sim.scalars.segmentCount < 10 ? g_sim.scalars.segmentCount : 10;
        for (int32_t s = 0; s < checkSegs; s++) {
          const float* seg = &g_sim.playerPoses[s * 5];
          if (c_hypotf(p.x - seg[0], p.z - seg[2]) < seg[4] + 0.22f && c_fabsf(p.y - seg[1]) < 0.75f) {
            hitSnake = true;
            break;
          }
        }
      }
      if (hitSnake) {
        sim_damage_snake(static_cast<float>(p.damage), p.x, p.y, p.z);
        g_sim.projectiles[i] = g_sim.projectiles[--g_sim.projectileCount];
        continue;
      }

      // Rival village bolts can hit villagers from OTHER villages!
      if (p.ownerVillageId >= 0) {
        bool hitRival = false;
        for (int32_t vi = g_sim.villagerCount - 1; vi >= 0; vi--) {
          VillagerSlot& rv = g_sim.villagers[vi];
          if (rv.state == VSTATE_KO || rv.homeVillageId == p.ownerVillageId) continue;
          if (c_hypotf(p.x - rv.x, p.z - rv.z) <= rv.radius + 0.35f && c_fabsf(p.y - (rv.y + 0.9f)) < 1.55f) {
            hit_villager(vi, static_cast<float>(p.damage) * 1.4f, false, p.ownerVillageId);
            hitRival = true;
            break;
          }
        }
        if (hitRival) {
          g_sim.projectiles[i] = g_sim.projectiles[--g_sim.projectileCount];
        }
      }
    } else {
      bool hitAny = false;
      for (int32_t vi = g_sim.villagerCount - 1; vi >= 0; vi--) {
        VillagerSlot& v = g_sim.villagers[vi];
        if (v.state == VSTATE_KO) continue;
        float hitRad = v.radius + p.radius + 0.38f;
        if (c_hypotf(p.x - v.x, p.z - v.z) <= hitRad && c_fabsf(p.y - (v.y + 0.95f)) < 1.85f) {
          v.poisonTimer = c_fmaxf(v.poisonTimer, p.kind == PROJ_MIST ? 5.0f : 5.5f);
          int32_t vid = v.id;
          float px = p.x, py = p.y, pz = p.z;
          hit_villager(vi, static_cast<float>(p.damage), false, -1);
          push_event(EVT_VENOM_HIT, vid, 0, 0, px, py, pz, static_cast<float>(p.damage), 0.0f);
          hitAny = true;
          break;
        }
      }
      if (hitAny) {
        g_sim.projectiles[i] = g_sim.projectiles[--g_sim.projectileCount];
      }
    }
  }
}

static void step_eggs_and_hatchlings(float dt) {
  for (int32_t i = g_sim.eggCount - 1; i >= 0; i--) {
    g_sim.laidEggs[i].age += dt;
    if (g_sim.laidEggs[i].age >= g_sim.laidEggs[i].hatchTime) {
      float ex = g_sim.laidEggs[i].x;
      float ey = g_sim.laidEggs[i].y;
      float ez = g_sim.laidEggs[i].z;
      g_sim.laidEggs[i] = g_sim.laidEggs[--g_sim.eggCount];
      sim_spawn_hatchling(ex, ey, ez);
    }
  }

  for (int32_t idx = 0; idx < g_sim.hatchlingCount; idx++) {
    HatchlingSlot& h = g_sim.hatchlings[idx];
    h.biteCooldown = c_fmaxf(0.0f, h.biteCooldown - dt);
    h.growth = c_fminf(1.5f, h.growth + 0.012f * dt);
    h.stage = h.growth >= 0.9f ? 3 : (h.growth >= 0.4f ? 2 : 1);

    float targetX = g_sim.scalars.headX;
    float targetZ = g_sim.scalars.headZ;
    int32_t targetVIdx = -1;
    int32_t targetPIdx = -1;
    float bestScore = 1e9f;

    for (int32_t vi = 0; vi < g_sim.villagerCount; vi++) {
      const VillagerSlot& v = g_sim.villagers[vi];
      if (v.state == VSTATE_KO) continue;
      float dFromSnake = c_hypotf(v.x - g_sim.scalars.headX, v.z - g_sim.scalars.headZ);
      float dFromH = c_hypotf(v.x - h.x, v.z - h.z);
      bool isHunter = (v.role == ROLE_SPEARMAN || v.role == ROLE_CROSSBOW);
      float maxRange = isHunter ? 24.0f : 16.0f;
      if (dFromSnake < maxRange || dFromH < maxRange * 0.8f) {
        float priorityScore = dFromH - (isHunter ? 6.5f : 0.0f);
        if (priorityScore < bestScore) {
          bestScore = priorityScore;
          targetVIdx = vi;
          targetX = v.x;
          targetZ = v.z;
        }
      }
    }

    if (targetVIdx < 0) {
      float bestPreyD = 12.5f;
      for (int32_t pi = 0; pi < g_sim.preyCount; pi++) {
        const PreySlot& pr = g_sim.prey[pi];
        if (pr.kind == PREY_EGG || pr.kind == PREY_BERRY) continue;
        float d = c_hypotf(pr.x - h.x, pr.z - h.z);
        if (d < bestPreyD) {
          bestPreyD = d;
          targetPIdx = pi;
          targetX = pr.x;
          targetZ = pr.z;
        }
      }
    }

    h.targetVillagerId = targetVIdx >= 0 ? g_sim.villagers[targetVIdx].id : -1;
    h.targetPreyId = targetPIdx >= 0 ? g_sim.prey[targetPIdx].id : -1;

    if (targetVIdx < 0 && targetPIdx < 0) {
      float flankSide = (idx & 1) == 0 ? 1.0f : -1.0f;
      float rank = static_cast<float>(idx / 2 + 1);
      float backOff = 1.6f + rank * 1.45f;
      float sideOff = flankSide * (1.35f + static_cast<float>((idx / 2 + 1) & 1) * 0.75f);
      float fx = c_sinf(g_sim.scalars.heading);
      float fz = c_cosf(g_sim.scalars.heading);
      float rx = c_cosf(g_sim.scalars.heading);
      float rz = -c_sinf(g_sim.scalars.heading);
      targetX = g_sim.scalars.headX - fx * backOff + rx * sideOff;
      targetZ = g_sim.scalars.headZ - fz * backOff + rz * sideOff;
    }

    float dx = targetX - h.x;
    float dz = targetZ - h.z;
    float distTarget = c_hypotf(dx, dz);
    float desiredHeading = distTarget > 0.25f ? c_atan2f(dx, dz) : g_sim.scalars.heading;
    float diff = normalize_angle(desiredHeading - h.heading);
    float sgn = diff >= 0.0f ? 1.0f : -1.0f;
    h.heading = normalize_angle(h.heading + sgn * c_fminf(c_fabsf(diff), 5.6f * dt));

    bool attacking = (targetVIdx >= 0 || targetPIdx >= 0);
    float desiredSpeed = attacking
        ? (6.9f + h.growth * 1.9f)
        : (distTarget > 2.2f ? c_fminf(8.2f, c_fmaxf(4.2f, g_sim.scalars.speed * 1.08f + distTarget * 0.45f))
                             : c_fmaxf(3.6f, g_sim.scalars.speed * 0.92f));
    if (!attacking && distTarget < 2.2f && g_sim.scalars.speed < 0.2f) {
      desiredSpeed = 0.0f;
    }
    h.speed += (desiredSpeed - h.speed) * (1.0f - c_expf(-8.0f * dt));

    float stepD = h.speed * dt;
    float nx = h.x + c_sinf(h.heading) * stepD;
    float nz = h.z + c_cosf(h.heading) * stepD;
    float dummyNx = 0.0f, dummyNz = 0.0f;
    resolve_solid_point(nx, nz, h.y, 0.24f, dummyNx, dummyNz);

    float moved = c_hypotf(nx - h.x, nz - h.z);
    h.x = nx;
    h.z = nz;
    float targetY = surface_height_at(h.x, h.z, h.y);
    h.y += (targetY - h.y) * c_fminf(1.0f, 18.0f * dt);

    if (moved > 1e-4f) {
      h.totalDist += moved;
      float* hSpine = g_sim.hatchlingSpines[idx];
      if (h.spineLen == 0 || h.totalDist - hSpine[3] >= 0.06f) {
        int32_t moveCount = h.spineLen < 47 ? h.spineLen : 47;
        for (int32_t s = moveCount; s >= 1; s--) {
          hSpine[s * 4]     = hSpine[(s - 1) * 4];
          hSpine[s * 4 + 1] = hSpine[(s - 1) * 4 + 1];
          hSpine[s * 4 + 2] = hSpine[(s - 1) * 4 + 2];
          hSpine[s * 4 + 3] = hSpine[(s - 1) * 4 + 3];
        }
        hSpine[0] = h.x;
        hSpine[1] = h.y;
        hSpine[2] = h.z;
        hSpine[3] = h.totalDist;
        if (h.spineLen < 48) h.spineLen++;
      } else {
        hSpine[0] = h.x;
        hSpine[1] = h.y;
        hSpine[2] = h.z;
        hSpine[3] = h.totalDist;
      }
      sim_recompute_hatchling_poses(idx);
    }

    if (targetVIdx >= 0 && h.biteCooldown <= 0.0f) {
      VillagerSlot& tv = g_sim.villagers[targetVIdx];
      float hitDist = c_hypotf(tv.x - h.x, tv.z - h.z);
      if (hitDist < tv.radius + 0.58f && c_fabsf(tv.y - h.y) < 1.35f) {
        h.biteCooldown = 0.72f;
        float biteDmg = 10.0f + h.growth * 11.0f;
        bool wasAlive = tv.hp > 0.0f;
        hit_villager(targetVIdx, biteDmg, true, -1);
        h.growth = c_fminf(1.5f, h.growth + (wasAlive && tv.hp <= 0.0f ? 0.28f : 0.14f));
        h.stage = h.growth >= 0.9f ? 3 : (h.growth >= 0.4f ? 2 : 1);
      }
    } else if (targetPIdx >= 0 && h.biteCooldown <= 0.0f && targetPIdx < g_sim.preyCount) {
      PreySlot tp = g_sim.prey[targetPIdx];
      float hitDist = c_hypotf(tp.x - h.x, tp.z - h.z);
      if (hitDist < tp.radius + 0.45f && c_fabsf(tp.y - h.y) < 1.1f) {
        h.biteCooldown = 0.85f;
        g_sim.prey[targetPIdx] = g_sim.prey[--g_sim.preyCount];
        g_sim.scalars.score += static_cast<float>(tp.points);
        if (g_sim.scalars.score > g_sim.scalars.bestScore) {
          g_sim.scalars.bestScore = g_sim.scalars.score;
        }
        if (g_sim.scalars.segmentCount < MAX_SEGMENTS) g_sim.scalars.segmentCount++;
        h.growth = c_fminf(1.5f, h.growth + 0.22f);
        h.stage = h.growth >= 0.9f ? 3 : (h.growth >= 0.4f ? 2 : 1);
        push_event(EVT_EAT, tp.id, tp.kind, g_sim.scalars.combo, tp.x, tp.y, tp.z, static_cast<float>(tp.points), 0.0f);
        sim_spawn_prey(0, 0, 0, 0.0f, 0.0f, 0, 0.0f);
      }
    }
  }
}

static void step_prey_movement(float dt, bool fleeFromSnake) {
  float sc = c_clampf(g_sim.scalars.snakeScale, START_SNAKE_SCALE, MAX_SNAKE_SCALE);
  for (int32_t pi = 0; pi < g_sim.preyCount; pi++) {
    PreySlot& prey = g_sim.prey[pi];
    if (prey.kind == PREY_EGG || prey.kind == PREY_BERRY) continue;

    float dxS = prey.x - g_sim.scalars.headX;
    float dzS = prey.z - g_sim.scalars.headZ;
    float dyS = prey.y - g_sim.scalars.headY;
    float distSnake = c_hypotf3(dxS, dzS, dyS);

    float fleeSight = 7.8f;
    if (prey.kind == PREY_DEER) fleeSight = 13.5f;
    else if (prey.kind == PREY_BOAR) fleeSight = 9.5f;
    else if (prey.kind == PREY_ELEPHANT) fleeSight = (sc >= 0.96f) ? 11.0f : 0.0f;

    bool isFleeing = fleeFromSnake && distSnake < fleeSight && distSnake > 0.1f;
    prey.fleeing = isFleeing ? 1 : 0;

    if (isFleeing) {
      prey.idleTimer = 0.0f;
      float fleeAngle = c_atan2f(dxS, dzS);
      float diff = normalize_angle(fleeAngle - prey.heading);
      float sgn = diff >= 0.0f ? 1.0f : -1.0f;
      float turnSpd = prey.kind == PREY_ELEPHANT ? 2.8f : 6.5f;
      prey.heading = normalize_angle(prey.heading + sgn * c_fminf(c_fabsf(diff), turnSpd * dt));
    } else if (prey.kind == PREY_ELEPHANT && fleeFromSnake && distSnake < 10.5f && sc < 0.85f) {
      // Calm territorial bull elephant turns proudly to face small snakes
      prey.idleTimer = 0.0f;
      float faceAngle = c_atan2f(-dxS, -dzS);
      float diff = normalize_angle(faceAngle - prey.heading);
      float sgn = diff >= 0.0f ? 1.0f : -1.0f;
      prey.heading = normalize_angle(prey.heading + sgn * c_fminf(c_fabsf(diff), 1.9f * dt));
    } else {
      if (prey.idleTimer > 0.0f) {
        prey.idleTimer -= dt;
        prey.vx = 0.0f;
        prey.vz = 0.0f;
        continue;
      }
      float cycle = c_fmodf_pos(g_sim.scalars.elapsedSeconds * 0.45f + prey.phase, 3.2f);
      if (cycle > 2.4f && c_fabsf(prey.vx) + c_fabsf(prey.vz) > 0.1f) {
        prey.idleTimer = (prey.kind == PREY_ELEPHANT ? 1.1f : 0.65f) + static_cast<float>(prey.id % 5) * 0.15f;
        prey.vx = 0.0f;
        prey.vz = 0.0f;
        continue;
      }
      float wanderTurn = prey.kind == PREY_ELEPHANT ? 0.55f : 1.1f;
      prey.heading = normalize_angle(
          prey.heading + c_sinf(g_sim.scalars.elapsedSeconds * 1.15f + prey.phase) * wanderTurn * dt);
    }

    float baseMoveSpeed = 1.05f;
    float fleeMult = 1.52f;
    if (prey.kind == PREY_RABBIT)        { baseMoveSpeed = 2.65f; fleeMult = 1.52f; }
    else if (prey.kind == PREY_MOUSE)    { baseMoveSpeed = 2.25f; fleeMult = 1.48f; }
    else if (prey.kind == PREY_DEER)     { baseMoveSpeed = 3.15f; fleeMult = 1.54f; }
    else if (prey.kind == PREY_BOAR)     { baseMoveSpeed = 2.35f; fleeMult = 1.44f; }
    else if (prey.kind == PREY_ELEPHANT) { baseMoveSpeed = 1.35f; fleeMult = 1.38f; }
    float speed = baseMoveSpeed * (isFleeing ? fleeMult : 0.78f);

    float nextX = prey.x + c_sinf(prey.heading) * speed * dt;
    float nextZ = prey.z + c_cosf(prey.heading) * speed * dt;

    float nx = 0.0f, nz = 0.0f;
    if (resolve_solid_point(nextX, nextZ, prey.y, prey.radius * 0.9f, nx, nz)) {
      prey.heading = normalize_angle(c_atan2f(nx, nz) + 0.35f);
    }
    if ((prey.kind == PREY_ELEPHANT || prey.kind == PREY_DEER || prey.kind == PREY_BOAR) &&
        is_inside_village(nextX, nextZ, 2.5f)) {
      float tx = nextX - prey.x;
      float tz = nextZ - prey.z;
      prey.heading = normalize_angle(c_atan2f(-tx, -tz) + 0.45f);
      nextX = prey.x;
      nextZ = prey.z;
    }

    float stepDist = c_hypotf(nextX - prey.x, nextZ - prey.z);
    float invDt = 1.0f / c_fmaxf(dt, 1e-4f);
    prey.vx = (nextX - prey.x) * invDt;
    prey.vz = (nextZ - prey.z) * invDt;
    prey.x = nextX;
    prey.z = nextZ;

    float targetY = surface_height_at(prey.x, prey.z, prey.y);
    if (targetY < prey.y - 0.12f) {
      prey.y = c_fmaxf(targetY, prey.y - 6.0f * dt);
    } else {
      prey.y = targetY;
    }

    float gaitRate = 4.2f;
    if (prey.kind == PREY_RABBIT)        gaitRate = 3.4f;
    else if (prey.kind == PREY_MOUSE)    gaitRate = 8.5f;
    else if (prey.kind == PREY_DEER)     gaitRate = 2.75f;
    else if (prey.kind == PREY_BOAR)     gaitRate = 3.65f;
    else if (prey.kind == PREY_ELEPHANT) gaitRate = 1.85f;
    prey.gaitPhase += stepDist * gaitRate;
  }
}

static void apply_slide_deflection(float normalX, float normalZ, float dt) {
  if (normalX == 0.0f && normalZ == 0.0f) return;
  float fx = c_sinf(g_sim.scalars.heading);
  float fz = c_cosf(g_sim.scalars.heading);
  float dot = fx * normalX + fz * normalZ;
  if (dot < 0.0f) {
    float tx = fx - dot * normalX;
    float tz = fz - dot * normalZ;
    if (c_hypotf(tx, tz) > 0.06f) {
      float slideHeading = c_atan2f(tx, tz);
      float hDiff = normalize_angle(slideHeading - g_sim.scalars.heading);
      g_sim.scalars.heading = normalize_angle(g_sim.scalars.heading + hDiff * c_fminf(1.0f, 14.0f * dt));
    } else {
      float tangentHeading = c_atan2f(-normalZ, normalX);
      float hDiff = normalize_angle(tangentHeading - g_sim.scalars.heading);
      g_sim.scalars.heading = normalize_angle(g_sim.scalars.heading + hDiff * c_fminf(1.0f, 10.0f * dt));
    }
  }
}

void sim_step_title_demo(float dt) {
  float safeDt = c_fminf(dt, 0.05f);
  g_sim.scalars.elapsedSeconds += safeDt;
  g_sim.scalars.tongueTimer += safeDt;

  step_prey_movement(safeDt, false);
  step_villagers(safeDt, false);

  float targetRadius = 7.4f;
  float t = g_sim.scalars.elapsedSeconds * 0.42f;
  float nextX = c_sinf(t) * targetRadius;
  float nextZ = c_cosf(t * 0.85f) * (targetRadius * 0.72f);
  float dx = nextX - g_sim.scalars.headX;
  float dz = nextZ - g_sim.scalars.headZ;
  float stepLen = c_hypotf(dx, dz);

  if (stepLen > 1e-4f) {
    g_sim.scalars.heading = c_atan2f(dx, dz);
    g_sim.scalars.headX = nextX;
    g_sim.scalars.headZ = nextZ;
    g_sim.scalars.headY = ground_height_at(nextX, nextZ);
    g_sim.scalars.totalDist += stepLen;
    push_player_spine_point(nextX, g_sim.scalars.headY, nextZ, g_sim.scalars.totalDist);
  }
  sim_compute_segment_poses();
}

void sim_step(
    float dt,
    int32_t left,
    int32_t right,
    int32_t up,
    int32_t down,
    int32_t boost,
    float steerAxis,
    float moveThrottle,
    float joyX,
    float joyY) {
  if (g_sim.scalars.phase != PHASE_PLAYING) return;
  float safeDt = c_fminf(dt, 0.05f);
  if (safeDt <= 0.0f) return;

  g_sim.scalars.elapsedSeconds += safeDt;
  g_sim.scalars.tongueTimer += safeDt;
  g_sim.scalars.invulnTimer = c_fmaxf(0.0f, g_sim.scalars.invulnTimer - safeDt);
  g_sim.scalars.eggCooldown = c_fmaxf(0.0f, g_sim.scalars.eggCooldown - safeDt);
  g_sim.scalars.powerCooldown = c_fmaxf(0.0f, g_sim.scalars.powerCooldown - safeDt);
  g_sim.scalars.secondaryCooldown = c_fmaxf(0.0f, g_sim.scalars.secondaryCooldown - safeDt);
  g_sim.scalars.tailGrabCooldown = c_fmaxf(0.0f, g_sim.scalars.tailGrabCooldown - safeDt);
  g_sim.scalars.grabWhipTimer = c_fmaxf(0.0f, g_sim.scalars.grabWhipTimer - safeDt);
  g_sim.scalars.stealthTimer = c_fmaxf(0.0f, g_sim.scalars.stealthTimer - safeDt);
  g_sim.scalars.powerPulseTimer = c_fmaxf(0.0f, g_sim.scalars.powerPulseTimer - safeDt);
  if (g_sim.scalars.swallowBulgeT > 0.0f) {
    g_sim.scalars.swallowBulgeT = c_fmaxf(0.0f, g_sim.scalars.swallowBulgeT - safeDt / 3.2f);
  }
  if (g_sim.scalars.grabStage == 1) {
    g_sim.scalars.grabTimer = c_fmaxf(0.0f, g_sim.scalars.grabTimer - safeDt);
  } else if (g_sim.scalars.grabStage == 2 && g_sim.scalars.grabWhipTimer <= 0.0f) {
    g_sim.scalars.grabStage = 0;
  }
  g_sim.scalars.outOfCombatTimer += safeDt;
  if (g_sim.scalars.outOfCombatTimer > 4.5f && g_sim.scalars.hp < static_cast<float>(g_sim.scalars.maxHp)) {
    g_sim.scalars.hp = c_fminf(static_cast<float>(g_sim.scalars.maxHp), g_sim.scalars.hp + 1.8f * safeDt);
  }

  tick_strike_cds(safeDt);

  step_prey_movement(safeDt, true);
  step_villagers(safeDt, true);
  step_projectiles(safeDt);
  if (g_sim.scalars.phase != PHASE_PLAYING) return;

  step_eggs_and_hatchlings(safeDt);

  if (g_sim.scalars.combo > 1) {
    g_sim.scalars.comboTimer -= safeDt;
    if (g_sim.scalars.comboTimer <= 0.0f) {
      g_sim.scalars.combo = 1;
      g_sim.scalars.comboTimer = 0.0f;
    }
  }

  SpeciesTraits traits = get_species_traits(g_sim.scalars.species);
  float effectiveTurnRate = TURN_RATE * g_sim.scalars.turnSensitivity * traits.turnMult;
  float sc = c_clampf(g_sim.scalars.snakeScale, START_SNAKE_SCALE, MAX_SNAKE_SCALE);
  float headColRad = HEAD_RADIUS * sc * 0.96f;

  // Manual-Only Locomotion: zero auto-slither!
  float joyMagRaw = c_hypotf(joyX, joyY);
  float joyMag = c_fmaxf(c_clampf(moveThrottle, 0.0f, 1.0f), c_clampf(joyMagRaw, 0.0f, 1.0f));
  bool joyActive = joyMag > 0.14f;
  bool keyCardinal = (left != 0) || (right != 0) || (up != 0) || (down != 0);

  bool wantsMove = false;
  float moveFactor = 1.0f;

  if (g_sim.scalars.cameraMode == CAM_CANOPY) {
    float moveX = joyActive && joyMagRaw > 0.05f
        ? joyX
        : (static_cast<float>(right ? 1 : 0) - static_cast<float>(left ? 1 : 0));
    float moveZ = joyActive && joyMagRaw > 0.05f
        ? joyY
        : (static_cast<float>(down ? 1 : 0) - static_cast<float>(up ? 1 : 0));
    if (moveX != 0.0f || moveZ != 0.0f) {
      wantsMove = true;
      moveFactor = joyActive ? c_clampf(joyMag, 0.25f, 1.0f) : 1.0f;
      float desiredHeading = c_atan2f(moveX, moveZ);
      float diff = normalize_angle(desiredHeading - g_sim.scalars.heading);
      float maxDelta = effectiveTurnRate * 1.45f * safeDt;
      if (c_fabsf(diff) <= maxDelta) {
        g_sim.scalars.heading = desiredHeading;
      } else {
        float sgn = diff >= 0.0f ? 1.0f : -1.0f;
        g_sim.scalars.heading = normalize_angle(g_sim.scalars.heading + sgn * maxDelta);
      }
    } else if (c_fabsf(steerAxis) > 0.05f) {
      g_sim.scalars.heading = normalize_angle(g_sim.scalars.heading - steerAxis * effectiveTurnRate * safeDt);
    }
  } else {
    float steerInput = 0.0f;
    if (left) steerInput += 1.0f;
    if (right) steerInput -= 1.0f;
    if (c_fabsf(steerAxis) > 0.05f && steerInput == 0.0f) {
      steerInput = -steerAxis;
    } else if (joyActive && c_fabsf(steerInput) < 0.05f && joyY > 0.45f) {
      // If joystick pushed straight back in Chase camera, smoothly turn snake around
      steerInput = 1.0f;
    }
    g_sim.scalars.heading = normalize_angle(g_sim.scalars.heading + steerInput * effectiveTurnRate * safeDt);

    if (up != 0 || joyActive) {
      wantsMove = true;
      moveFactor = joyActive ? c_clampf(joyMag, 0.28f, 1.0f) : 1.0f;
    } else if (keyCardinal && down == 0 && boost != 0) {
      wantsMove = true;
    }
  }

  bool wantsBoost = wantsMove && (boost != 0);
  if (wantsBoost && g_sim.scalars.stamina > 2.0f) {
    g_sim.scalars.isBoosting = 1;
    g_sim.scalars.stamina = c_fmaxf(0.0f, g_sim.scalars.stamina - 34.0f * traits.staminaDrainMult * safeDt);
  } else {
    g_sim.scalars.isBoosting = 0;
    g_sim.scalars.stamina = c_fminf(100.0f, g_sim.scalars.stamina + 18.0f * safeDt);
  }

  DifficultyParams diff = get_diff_params(g_sim.scalars.difficulty);
  float growthRatio = c_fminf(
      1.0f,
      static_cast<float>(g_sim.scalars.segmentCount - INITIAL_SEGMENTS) /
          static_cast<float>(MAX_SEGMENTS - INITIAL_SEGMENTS));
  float stealthBoost = g_sim.scalars.stealthTimer > 0.0f ? 1.22f : 1.0f;
  float sizeSpeedScale = 0.88f + sc * 0.18f;
  float targetBaseSpeed = (BASE_SPEED + growthRatio * MAX_SPEED_BONUS) * diff.speedMult * traits.speedMult * stealthBoost * sizeSpeedScale;
  float targetSpeed = wantsMove ? targetBaseSpeed * moveFactor * (g_sim.scalars.isBoosting ? BOOST_MULTIPLIER : 1.0f) : 0.0f;

  g_sim.scalars.speed += (targetSpeed - g_sim.scalars.speed) * (1.0f - c_expf((wantsMove ? -11.0f : -16.0f) * safeDt));
  if (!wantsMove && g_sim.scalars.speed < 0.08f) {
    g_sim.scalars.speed = 0.0f;
  }

  float prevX = g_sim.scalars.headX;
  float prevZ = g_sim.scalars.headZ;
  float totalStepDist = g_sim.scalars.speed * safeDt;
  float nextX = prevX;
  float nextZ = prevZ;

  // 2 physics substeps when moving fast to prevent phasing through fences/walls/logs
  int32_t substeps = (totalStepDist > 0.22f) ? 2 : 1;
  float subStep = totalStepDist / static_cast<float>(substeps);
  float subDt = safeDt / static_cast<float>(substeps);

  for (int32_t st = 0; st < substeps; st++) {
    if (subStep > 0.0f) {
      nextX += c_sinf(g_sim.scalars.heading) * subStep;
      nextZ += c_cosf(g_sim.scalars.heading) * subStep;
    }
    float nx = 0.0f, nz = 0.0f;
    if (resolve_solid_point(nextX, nextZ, g_sim.scalars.headY, headColRad, nx, nz)) {
      if (wantsMove) {
        apply_slide_deflection(nx, nz, subDt);
      }
    }
  }

  g_sim.scalars.headX = nextX;
  g_sim.scalars.headZ = nextZ;

  // 3D Self-Coil Climb-Over (starts from segment 5 when looping back so coils ride OVER instead of clipping inside)
  float selfCoilTopY = -1000.0f;
  int32_t curSegs = g_sim.scalars.segmentCount;
  if (curSegs > MAX_SEGMENTS) curSegs = MAX_SEGMENTS;
  float hFwdX = c_sinf(g_sim.scalars.heading);
  float hFwdZ = c_cosf(g_sim.scalars.heading);
  for (int32_t i = 5; i < curSegs; i++) {
    int32_t p = i * 5;
    float dx = nextX - g_sim.playerPoses[p];
    float dz = nextZ - g_sim.playerPoses[p + 2];
    float segY = g_sim.playerPoses[p + 1];
    float rad = g_sim.playerPoses[p + 4];
    float reach = HEAD_RADIUS * sc * 0.88f + rad * 0.94f;
    float d2 = dx * dx + dz * dz;
    if (d2 < reach * reach && g_sim.scalars.headY + 0.72f * sc >= segY - rad) {
      // Skip segments 5..9 unless the snake has actually looped back across them
      if (i < SELF_COLLISION_SKIP) {
        float segDot = (dx * hFwdX + dz * hFwdZ);
        if (segDot > 0.08f * sc) continue;
      }
      float d = c_sqrtf(d2);
      float ratio = c_fminf(1.0f, d / reach);
      float arch = c_cosf(ratio * HALF_PI);
      float top = segY + rad * (0.72f + 0.44f * arch);
      if (top > selfCoilTopY) selfCoilTopY = top;
    }
  }

  float baseSurfaceY = surface_height_at(nextX, nextZ, g_sim.scalars.headY);
  float targetSurfaceY = c_fmaxf(baseSurfaceY, selfCoilTopY);

  if (targetSurfaceY < g_sim.scalars.headY - 0.14f) {
    g_sim.scalars.headVelY -= 16.5f * safeDt;
    g_sim.scalars.headY = c_fmaxf(targetSurfaceY, g_sim.scalars.headY + g_sim.scalars.headVelY * safeDt);
    if (g_sim.scalars.headY <= targetSurfaceY + 0.01f) {
      g_sim.scalars.headY = targetSurfaceY;
      g_sim.scalars.headVelY = 0.0f;
    }
  } else {
    g_sim.scalars.headVelY = 0.0f;
    g_sim.scalars.headY += (targetSurfaceY - g_sim.scalars.headY) * c_fminf(1.0f, 20.0f * safeDt);
  }

  float actualStep = c_hypotf(nextX - prevX, nextZ - prevZ);
  if (actualStep > 1e-4f) {
    g_sim.scalars.totalDist += actualStep;
    push_player_spine_point(nextX, g_sim.scalars.headY, nextZ, g_sim.scalars.totalDist);
  } else if (g_sim.scalars.spineLen >= 2) {
    // When turning in place without forward travel, pivot the upper body smoothly so the neck never twists inside itself
    const float* s1 = spine_at(1);
    float ndx = nextX - s1[0];
    float ndz = nextZ - s1[2];
    if (c_hypotf(ndx, ndz) > 1e-4f) {
      float neckYaw = c_atan2f(ndx, ndz);
      float bend = normalize_angle(g_sim.scalars.heading - neckYaw);
      constexpr float MAX_NECK_BEND = 0.68f;
      if (c_fabsf(bend) > MAX_NECK_BEND) {
        float excess = bend > 0.0f ? (bend - MAX_NECK_BEND) : (bend + MAX_NECK_BEND);
        int32_t pivotLimit = g_sim.scalars.spineLen < 44 ? g_sim.scalars.spineLen : 44;
        for (int32_t k = 1; k < pivotLimit; k++) {
          float falloff = c_expf(-static_cast<float>(k) * 0.085f);
          float rot = excess * falloff;
          float cs = c_cosf(rot);
          float sn = c_sinf(rot);
          float* sp = spine_at(k);
          float rx = sp[0] - nextX;
          float rz = sp[2] - nextZ;
          // Y-up clockwise/counter-clockwise yaw rotation matching atan2(x, z)
          float nx = nextX + (rx * cs + rz * sn);
          float nz = nextZ + (-rx * sn + rz * cs);
          sp[0] = nx;
          sp[2] = nz;
          sp[1] = surface_height_at(nx, nz, sp[1]);
        }
        float* s0 = spine_at(0);
        s0[0] = nextX;
        s0[1] = g_sim.scalars.headY;
        s0[2] = nextZ;
      }
    }
  }
  sim_compute_segment_poses();

  BuildingLocResult loc = get_building_at_position(nextX, nextZ, g_sim.scalars.headY);
  g_sim.scalars.activeBuildingId = loc.buildingId;
  g_sim.scalars.hideActiveRoof = loc.hideRoof;
  g_sim.scalars.isIndoors = loc.isIndoors;
  g_sim.scalars.locZoneType = loc.zoneType;
  g_sim.scalars.locZoneIdx = loc.zoneIdx;
  g_sim.scalars.locBuildingIdx = loc.buildingIdx;
  g_sim.scalars.activeVillageId = find_village_at(nextX, nextZ, 6.0f);

  // Snake Bite against Villagers & Hunters (Blood Drink when small, Whole Swallow when grown!)
  for (int32_t vi = 0; vi < g_sim.villagerCount; vi++) {
    VillagerSlot& v = g_sim.villagers[vi];
    if (v.state == VSTATE_KO || v.grabbed != 0) continue;
    float horizD = c_hypotf(v.x - nextX, v.z - nextZ);
    float vertD = c_fabsf(v.y - g_sim.scalars.headY);
    if (horizD <= HEAD_RADIUS * sc + v.radius + 0.42f && vertD < 1.65f) {
      if (!has_strike_cd(v.id)) {
        perform_snake_feeding_hit(vi, false);
      }
    }
  }

  // Mouth proximity
  float nearestDist = 1e9f;
  for (int32_t pi = 0; pi < g_sim.preyCount; pi++) {
    const PreySlot& pr = g_sim.prey[pi];
    float d = c_hypotf3(pr.x - nextX, pr.y - g_sim.scalars.headY, pr.z - nextZ);
    if (d < nearestDist) nearestDist = d;
  }
  for (int32_t vi = 0; vi < g_sim.villagerCount; vi++) {
    const VillagerSlot& v = g_sim.villagers[vi];
    if (v.state == VSTATE_KO) continue;
    float d = c_hypotf3(v.x - nextX, v.y - g_sim.scalars.headY, v.z - nextZ);
    if (d < nearestDist) nearestDist = d;
  }
  g_sim.scalars.nearPrey = nearestDist < 4.5f ? 1 : 0;
  float targetMouth = nearestDist < 2.8f ? c_fminf(1.0f, (2.8f - nearestDist) / 2.0f) : 0.0f;
  g_sim.scalars.mouthOpen += (targetMouth - g_sim.scalars.mouthOpen) * (1.0f - c_expf(-14.0f * safeDt));

  // Eat Prey, Wild Eggs & Large Wilderness Beasts (Size-Gated Blood Drink vs Whole Swallow)
  for (int32_t pi = g_sim.preyCount - 1; pi >= 0; pi--) {
    PreySlot& pr = g_sim.prey[pi];
    float horizD = c_hypotf(pr.x - nextX, pr.z - nextZ);
    float vertD = c_fabsf(pr.y - g_sim.scalars.headY);
    float reach = HEAD_RADIUS * sc + pr.radius + 0.45f;
    if (horizD <= reach && vertD < (pr.kind == PREY_ELEPHANT ? 2.6f : 1.55f)) {
      float swallowReq = 0.0f;
      if (pr.kind == PREY_DEER || pr.kind == PREY_BOAR) swallowReq = 0.72f;
      else if (pr.kind == PREY_ELEPHANT) swallowReq = 1.12f;

      if (swallowReq > 0.0f && sc < swallowReq) {
        // Small snake bites large beast to drink blood & grow instead of instantly swallowing an elephant whole
        if (!has_strike_cd(pr.id)) {
          set_strike_cd(pr.id, 0.58f);
          g_sim.scalars.mouthOpen = 1.0f;
          g_sim.scalars.score += 35.0f;
          if (g_sim.scalars.score > g_sim.scalars.bestScore) {
            g_sim.scalars.bestScore = g_sim.scalars.score;
          }
          g_sim.scalars.hp = c_fminf(static_cast<float>(g_sim.scalars.maxHp), g_sim.scalars.hp + 10.0f);
          g_sim.scalars.stamina = c_fminf(100.0f, g_sim.scalars.stamina + 22.0f);
          g_sim.scalars.snakeScale = c_fminf(MAX_SNAKE_SCALE, g_sim.scalars.snakeScale + 0.032f);
          if (g_sim.scalars.segmentCount < MAX_SEGMENTS) {
            g_sim.scalars.segmentCount++;
          }
          push_event(EVT_BLOOD_DRINK, pr.id, 0, 0, pr.x, pr.y + 0.85f, pr.z, 26.0f, g_sim.scalars.snakeScale);
          if (pr.kind == PREY_ELEPHANT && sc < 0.78f && g_sim.scalars.invulnTimer <= 0.0f) {
            sim_damage_snake(5.0f, pr.x, pr.y, pr.z);
          }
        }
        // Gently separate small snake from elephant/beast solid body
        float d = c_fmaxf(0.15f, horizD);
        float pushMin = HEAD_RADIUS * sc + pr.radius * 0.82f;
        if (d < pushMin) {
          g_sim.scalars.headX = pr.x + ((nextX - pr.x) / d) * pushMin;
          g_sim.scalars.headZ = pr.z + ((nextZ - pr.z) / d) * pushMin;
        }
        continue;
      }

      PreySlot eaten = pr;
      g_sim.prey[pi] = g_sim.prey[--g_sim.preyCount];
      float awardedPoints = static_cast<float>(eaten.points * g_sim.scalars.combo);
      g_sim.scalars.score += awardedPoints;
      if (g_sim.scalars.score > g_sim.scalars.bestScore) {
        g_sim.scalars.bestScore = g_sim.scalars.score;
      }
      g_sim.scalars.combo = g_sim.scalars.combo < 8 ? g_sim.scalars.combo + 1 : 8;
      g_sim.scalars.comboTimer = COMBO_DURATION;
      g_sim.scalars.segmentCount = g_sim.scalars.segmentCount + eaten.growth < MAX_SEGMENTS
          ? g_sim.scalars.segmentCount + eaten.growth : MAX_SEGMENTS;
      float scaleGain = eaten.kind == PREY_ELEPHANT ? 0.085f
          : (eaten.kind == PREY_DEER || eaten.kind == PREY_BOAR ? 0.045f : 0.018f);
      g_sim.scalars.snakeScale = c_fminf(MAX_SNAKE_SCALE, g_sim.scalars.snakeScale + scaleGain);
      if (eaten.kind == PREY_ELEPHANT || eaten.kind == PREY_DEER || eaten.kind == PREY_BOAR) {
        g_sim.scalars.swallowBulgeT = 1.0f;
        g_sim.scalars.feastCount++;
        g_sim.scalars.powerTier = 1 + (g_sim.scalars.feastCount / 3);
        if (g_sim.scalars.powerTier > 4) g_sim.scalars.powerTier = 4;
      }
      g_sim.scalars.stamina = c_fminf(100.0f, g_sim.scalars.stamina + static_cast<float>(eaten.staminaGain));
      float heal = eaten.kind == PREY_BERRY ? 4.0f : (eaten.kind == PREY_ELEPHANT ? 28.0f : 10.0f);
      g_sim.scalars.hp = c_fminf(static_cast<float>(g_sim.scalars.maxHp), g_sim.scalars.hp + heal);

      push_event(EVT_EAT, eaten.id, eaten.kind, g_sim.scalars.combo, eaten.x, eaten.y, eaten.z, awardedPoints, 0.0f);

      if (eaten.kind == PREY_EGG) {
        sim_spawn_hatchling(eaten.x, eaten.y, eaten.z);
      }

      sim_spawn_prey(0, 0, 0, 0.0f, 0.0f, 0, 0.0f);

      if (g_sim.scalars.score - g_sim.scalars.lastHazardScoreMilestone >= 180.0f &&
          g_sim.obstacleCount < diff.maxObs + 24) {
        g_sim.scalars.lastHazardScoreMilestone = g_sim.scalars.score;
        spawn_obstacle();
      }
    }
  }
}

} // namespace serpentis
