#include "world_buildings.hpp"

namespace serpentis {

const VillageDef g_villages[NUM_VILLAGES] = {
  {0, "Timberhollow", 0.0f,    -52.0f,  42.0f, 32.0f, 7.5f, 7.0f, 0x5c809e},
  {1, "Ashford",      -128.0f, -112.0f, 38.0f, 30.0f, 7.0f, 6.5f, 0xb85242},
  {2, "Ravenbrook",   128.0f,  -112.0f, 38.0f, 30.0f, 7.0f, 6.5f, 0x7b5aa6},
  {3, "Sunhaven",     -162.0f, 24.0f,   38.0f, 30.0f, 7.0f, 6.5f, 0xd49a35},
  {4, "Ironvale",     162.0f,  24.0f,   38.0f, 30.0f, 7.0f, 6.5f, 0x617a8c},
  {5, "Mossglen",     -112.0f, 142.0f,  38.0f, 30.0f, 7.0f, 6.5f, 0x4b8f5c},
  {6, "Goldcrest",    112.0f,  142.0f,  38.0f, 30.0f, 7.0f, 6.5f, 0xc97438},
};

EnterableBuilding g_buildings[24];
int32_t g_building_count = 0;
WallBox g_fence_walls[72];
int32_t g_fence_count = 0;

int32_t find_village_at(float x, float z, float margin) {
  for (int32_t vi = 0; vi < NUM_VILLAGES; vi++) {
    const VillageDef& v = g_villages[vi];
    if (x >= v.centerX - v.halfW - margin &&
        x <= v.centerX + v.halfW + margin &&
        z >= v.centerZ - v.halfD - margin &&
        z <= v.centerZ + v.halfD + margin) {
      return vi;
    }
  }
  return -1;
}

bool is_inside_village(float x, float z, float margin) {
  return find_village_at(x, z, margin) >= 0;
}

float ground_height_at(float x, float z) {
  float r = c_hypotf(x, z);
  float micro =
      c_sinf(x * 0.055f) * c_cosf(z * 0.05f) * 0.54f +
      c_sinf(x * 0.14f + z * 0.13f) * 0.16f;

  // Flatten terrain smoothly within all 7 villages + approaches
  float minVillageDist = 1e6f;
  for (int32_t vi = 0; vi < NUM_VILLAGES; vi++) {
    const VillageDef& v = g_villages[vi];
    float dx = c_fmaxf(0.0f, c_fabsf(x - v.centerX) - v.halfW);
    float dz = c_fmaxf(0.0f, c_fabsf(z - v.centerZ) - (v.halfD + (vi == 0 ? 18.0f : 6.0f)));
    float vd = c_hypotf(dx, dz);
    if (vd < minVillageDist) minVillageDist = vd;
  }
  float villageFlat = c_fminf(1.0f, minVillageDist / 16.0f);
  float clearingFactor = c_fminf(1.0f, r / (ARENA_RADIUS * 0.85f));
  float innerHeight = micro * (0.10f + 0.90f * villageFlat) * (0.35f + 0.65f * clearingFactor);

  if (r <= ARENA_RADIUS) {
    return innerHeight;
  }

  float over = r - ARENA_RADIUS;
  float edgeAng = c_atan2f(z, x);
  float berm = c_fminf(
      8.5f,
      over * 0.45f + c_sinf(edgeAng * 7.0f + r * 0.12f) * 0.55f * c_fminf(1.0f, over * 0.25f));
  return innerHeight + berm;
}

void world_to_building_local(const EnterableBuilding& b, float wx, float wz, float& outLx, float& outLz) {
  float dx = wx - b.x;
  float dz = wz - b.z;
  float c = c_cosf(b.rotation);
  float s = c_sinf(b.rotation);
  outLx = (dx * c - dz * s) / b.scale;
  outLz = (dx * s + dz * c) / b.scale;
}

void building_local_to_world(const EnterableBuilding& b, float lx, float lz, float& outWx, float& outWz) {
  float sx = lx * b.scale;
  float sz = lz * b.scale;
  float c = c_cosf(b.rotation);
  float s = c_sinf(b.rotation);
  outWx = b.x + sx * c + sz * s;
  outWz = b.z - sx * s + sz * c;
}

static void init_cabin_blueprint(
    EnterableBuilding& b,
    int32_t id,
    const char* name,
    float x,
    float z,
    float rotation,
    float scale) {
  b.id = id;
  b.kind = BLDG_CABIN;
  b.name = name;
  b.x = x;
  b.z = z;
  b.rotation = rotation;
  b.scale = scale;
  b.footprintRadius = 7.4f * scale;

  b.floorCount = 4;
  b.floors[0] = {-4.15f, 4.15f, -3.35f, 3.35f, 0.28f, 1, 0, "Ground Floor"};
  b.floors[1] = {-2.8f, 2.8f, 3.35f, 5.15f, 0.28f, 0, 0, "Front Porch"};
  b.floors[2] = {-3.85f, 3.85f, -3.1f, -0.35f, 2.68f, 1, 0, "Upper Loft"};
  b.floors[3] = {-3.85f, -1.45f, -0.35f, 4.95f, 2.68f, 0, 1, "Loft Balcony"};

  b.rampCount = 3;
  b.ramps[0] = {-1.85f, 1.85f, 5.15f, 6.75f, 1, 6.75f, 5.15f, 0.0f, 0.28f, 0, "Porch Steps"};
  b.ramps[1] = {-5.35f, -4.15f, -1.1f, 1.1f, 0, -5.35f, -4.15f, 0.0f, 0.28f, 0, "Side Threshold"};
  b.ramps[2] = {1.75f, 3.75f, -0.35f, 2.75f, 1, 2.75f, -0.35f, 0.28f, 2.68f, 1, "Loft Stairway"};

  b.wallCount = 8;
  b.walls[0] = {-4.25f, -1.45f, 3.15f, 3.55f, 0.0f, 4.5f};
  b.walls[1] = {1.45f, 4.25f, 3.15f, 3.55f, 0.0f, 4.5f};
  b.walls[2] = {-4.25f, 4.25f, -3.55f, -3.15f, 0.0f, 5.0f};
  b.walls[3] = {3.95f, 4.35f, -3.45f, 3.45f, 0.0f, 5.0f};
  b.walls[4] = {-4.35f, -3.95f, 1.1f, 3.45f, 0.0f, 5.0f};
  b.walls[5] = {-4.35f, -3.95f, -3.45f, -1.1f, 0.0f, 5.0f};
  b.walls[6] = {-3.9f, -2.65f, -3.1f, -1.9f, 0.0f, 2.45f};
  b.walls[7] = {-1.45f, 1.75f, -0.45f, -0.25f, 2.68f, 3.35f};

  b.interiorSpotX = -0.6f; b.interiorSpotZ = 0.6f; b.interiorSpotY = 0.28f;
  b.upperSpotX = -2.4f;   b.upperSpotZ = 2.2f;   b.upperSpotY = 2.68f;
}

static void init_manor_blueprint(
    EnterableBuilding& b,
    int32_t id,
    const char* name,
    float x,
    float z,
    float rotation,
    float scale) {
  b.id = id;
  b.kind = BLDG_MANOR;
  b.name = name;
  b.x = x;
  b.z = z;
  b.rotation = rotation;
  b.scale = scale;
  b.footprintRadius = 7.5f * scale;

  b.floorCount = 2;
  b.floors[0] = {-4.45f, 4.45f, -3.65f, 3.65f, 0.24f, 1, 0, "Stone Hall"};
  b.floors[1] = {-4.25f, 4.25f, -3.45f, 1.25f, 2.9f, 0, 1, "Roof Terrace"};

  b.rampCount = 3;
  b.ramps[0] = {-1.65f, 1.65f, 3.65f, 5.05f, 1, 5.05f, 3.65f, 0.0f, 0.24f, 0, "Front Arch"};
  b.ramps[1] = {-1.65f, 1.65f, -5.05f, -3.65f, 1, -5.05f, -3.65f, 0.0f, 0.24f, 0, "Rear Arch"};
  b.ramps[2] = {2.0f, 4.1f, 0.85f, 3.35f, 1, 3.35f, 0.85f, 0.24f, 2.9f, 1, "Terrace Ramp"};

  b.wallCount = 9;
  b.walls[0] = {-4.55f, -1.5f, 3.45f, 3.85f, 0.0f, 3.8f};
  b.walls[1] = {1.5f, 4.55f, 3.45f, 3.85f, 0.0f, 3.8f};
  b.walls[2] = {-4.55f, -1.5f, -3.85f, -3.45f, 0.0f, 3.8f};
  b.walls[3] = {1.5f, 4.55f, -3.85f, -3.45f, 0.0f, 3.8f};
  b.walls[4] = {-4.65f, -4.25f, -3.75f, 3.75f, 0.0f, 3.8f};
  b.walls[5] = {4.25f, 4.65f, -3.75f, 3.75f, 0.0f, 3.8f};
  b.walls[6] = {-4.25f, 2.0f, 1.05f, 1.3f, 2.9f, 3.55f};
  b.walls[7] = {-4.3f, -4.05f, -3.45f, 1.25f, 2.9f, 3.55f};
  b.walls[8] = {-4.25f, 4.25f, -3.5f, -3.25f, 2.9f, 3.55f};

  b.interiorSpotX = -1.2f; b.interiorSpotZ = -0.4f; b.interiorSpotY = 0.24f;
  b.upperSpotX = -1.0f;    b.upperSpotZ = -1.2f;    b.upperSpotY = 2.9f;
}

static void init_ruin_blueprint(
    EnterableBuilding& b,
    int32_t id,
    const char* name,
    float x,
    float z,
    float rotation,
    float scale) {
  b.id = id;
  b.kind = BLDG_RUIN_TOWER;
  b.name = name;
  b.x = x;
  b.z = z;
  b.rotation = rotation;
  b.scale = scale;
  b.footprintRadius = 6.2f * scale;

  b.floorCount = 2;
  b.floors[0] = {-3.5f, 3.5f, -3.5f, 2.2f, 0.22f, 0, 0, "Ruin Courtyard"};
  b.floors[1] = {-3.3f, 3.3f, -3.3f, -0.2f, 2.05f, 0, 1, "Temple Terrace"};

  b.rampCount = 2;
  b.ramps[0] = {-1.5f, 1.5f, 2.2f, 3.6f, 1, 3.6f, 2.2f, 0.0f, 0.22f, 0, "Stone Steps"};
  b.ramps[1] = {-1.55f, 1.55f, -0.2f, 2.2f, 1, 2.2f, -0.2f, 0.22f, 2.05f, 0, "Altar Ramp"};

  b.wallCount = 4;
  b.walls[0] = {-3.35f, -2.45f, -3.35f, -2.45f, 0.0f, 4.6f};
  b.walls[1] = {2.45f, 3.35f, -3.35f, -2.45f, 0.0f, 4.6f};
  b.walls[2] = {-3.35f, -2.45f, 1.35f, 2.25f, 0.0f, 3.8f};
  b.walls[3] = {2.45f, 3.35f, 1.35f, 2.25f, 0.0f, 3.8f};

  b.interiorSpotX = 0.0f; b.interiorSpotZ = 0.9f;  b.interiorSpotY = 1.15f;
  b.upperSpotX = 0.0f;    b.upperSpotZ = -1.8f;    b.upperSpotY = 2.05f;
}

void init_world_buildings_and_fences() {
  int32_t bIdx = 0;
  int32_t nextBId = 9001;

  // Large buildings across all 7 villages (scales 2.48 - 2.85 so houses tower over starter snake)
  // Village 0: Timberhollow (0, -52)
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Timberhollow Lodge",   -21.0f, -36.5f,  0.14f, 2.65f);
  init_manor_blueprint(g_buildings[bIdx++], nextBId++, "Timberhollow Manor",    21.0f, -37.5f, -0.16f, 2.75f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Timberhollow Homestead", -20.5f, -68.5f,  3.02f, 2.58f);

  // Village 1: Ashford (-128, -112)
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Ashford Watch Cabin",   -147.0f, -127.0f,  0.15f, 2.52f);
  init_manor_blueprint(g_buildings[bIdx++], nextBId++, "Ashford Forge Hall",    -109.0f, -127.0f, -0.15f, 2.62f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Ashford Granary",       -146.5f,  -97.5f,  2.98f, 2.48f);

  // Village 2: Ravenbrook (128, -112)
  init_manor_blueprint(g_buildings[bIdx++], nextBId++, "Ravenbrook Guildhall",  109.0f, -127.0f,  0.15f, 2.62f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Ravenbrook Timberhouse", 147.0f, -127.0f, -0.15f, 2.52f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Ravenbrook Millhouse",  146.5f,  -97.5f, -2.98f, 2.48f);

  // Village 3: Sunhaven (-162, 24)
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Sunhaven Farmhouse",    -181.0f,  9.0f,   0.18f, 2.52f);
  init_manor_blueprint(g_buildings[bIdx++], nextBId++, "Sunhaven Steward Hall", -143.0f,  9.0f,  -0.16f, 2.62f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Sunhaven Orchard Barn", -180.5f,  38.5f,  2.96f, 2.48f);

  // Village 4: Ironvale (162, 24)
  init_manor_blueprint(g_buildings[bIdx++], nextBId++, "Ironvale Citadel",      143.0f,   9.0f,   0.16f, 2.65f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Ironvale Barracks",     181.0f,   9.0f,  -0.16f, 2.52f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Ironvale Armory",       143.5f,  38.5f,  2.96f, 2.50f);

  // Village 5: Mossglen (-112, 142)
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Mossglen Hunter Lodge", -131.0f, 127.0f,  0.16f, 2.54f);
  init_manor_blueprint(g_buildings[bIdx++], nextBId++, "Mossglen Timber Hall",   -93.0f, 127.0f, -0.18f, 2.62f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Mossglen Reed Cabin",   -130.5f, 156.5f,  2.98f, 2.48f);

  // Village 6: Goldcrest (112, 142)
  init_manor_blueprint(g_buildings[bIdx++], nextBId++, "Goldcrest Keep",         93.0f,  127.0f,  0.16f, 2.66f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Goldcrest Meadhouse",   131.0f,  127.0f, -0.16f, 2.54f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Goldcrest Gatehouse",   130.5f,  156.5f, -2.98f, 2.50f);

  // 2 Wilderness ancient temples / ranger outposts between villages
  init_ruin_blueprint(g_buildings[bIdx++], nextBId++, "Mossy Forest Temple",    64.0f,   52.0f, -2.25f, 2.60f);
  init_cabin_blueprint(g_buildings[bIdx++], nextBId++, "Deepwood Ranger Cabin", -64.0f,   48.0f,  0.75f, 2.52f);

  g_building_count = bIdx;

  // Build perimeter fences (with 4 wide gates) + central stone plaza well collider for all 7 villages
  g_fence_count = 0;
  float thick = 0.55f;
  for (int32_t vi = 0; vi < NUM_VILLAGES && g_fence_count + 9 <= 72; vi++) {
    const VillageDef& v = g_villages[vi];
    float minX = v.centerX - v.halfW;
    float maxX = v.centerX + v.halfW;
    float minZ = v.centerZ - v.halfD;
    float maxZ = v.centerZ + v.halfD;
    float cx = v.centerX;
    float cz = v.centerZ;
    float sGate = v.southGateHalfW;
    float eGate = v.sideGateHalfW;

    g_fence_walls[g_fence_count++] = {minX - thick, cx - sGate, maxZ - thick, maxZ + thick, 0.0f, 2.5f};
    g_fence_walls[g_fence_count++] = {cx + sGate, maxX + thick, maxZ - thick, maxZ + thick, 0.0f, 2.5f};
    g_fence_walls[g_fence_count++] = {minX - thick, cx - sGate, minZ - thick, minZ + thick, 0.0f, 2.5f};
    g_fence_walls[g_fence_count++] = {cx + sGate, maxX + thick, minZ - thick, minZ + thick, 0.0f, 2.5f};
    g_fence_walls[g_fence_count++] = {minX - thick, minX + thick, minZ - thick, cz - eGate, 0.0f, 2.5f};
    g_fence_walls[g_fence_count++] = {minX - thick, minX + thick, cz + eGate, maxZ + thick, 0.0f, 2.5f};
    g_fence_walls[g_fence_count++] = {maxX - thick, maxX + thick, minZ - thick, cz - eGate, 0.0f, 2.5f};
    g_fence_walls[g_fence_count++] = {maxX - thick, maxX + thick, cz + eGate, maxZ + thick, 0.0f, 2.5f};
    // Solid central stone plaza well collider (radius ~2.15m)
    g_fence_walls[g_fence_count++] = {cx - 2.15f, cx + 2.15f, cz - 2.15f, cz + 2.15f, 0.0f, 2.5f};
  }
}

float surface_height_at(float x, float z, float currentY) {
  float terrainY = ground_height_at(x, z);
  float bestY = terrainY;
  float bestDist = c_fabsf(currentY - terrainY);

  for (int32_t bi = 0; bi < g_building_count; bi++) {
    const EnterableBuilding& b = g_buildings[bi];
    float dx = x - b.x;
    float dz = z - b.z;
    if (dx * dx + dz * dz > b.footprintRadius * b.footprintRadius) continue;

    float baseTerrainY = ground_height_at(b.x, b.z);
    float lx = 0.0f, lz = 0.0f;
    world_to_building_local(b, x, z, lx, lz);

    float candY[12];
    bool candIsRamp[12];
    int32_t candCount = 0;

    candY[candCount] = terrainY;
    candIsRamp[candCount] = false;
    candCount++;

    for (int32_t fi = 0; fi < b.floorCount; fi++) {
      const FloorZone& f = b.floors[fi];
      if (lx >= f.minX && lx <= f.maxX && lz >= f.minZ && lz <= f.maxZ) {
        candY[candCount] = baseTerrainY + f.elevation * b.scale;
        candIsRamp[candCount] = false;
        candCount++;
      }
    }

    for (int32_t ri = 0; ri < b.rampCount; ri++) {
      const RampZone& r = b.ramps[ri];
      if (lx >= r.minX && lx <= r.maxX && lz >= r.minZ && lz <= r.maxZ) {
        float coord = (r.axis == 0) ? lx : lz;
        float span = r.endCoord - r.startCoord;
        float t = span != 0.0f ? c_clampf((coord - r.startCoord) / span, 0.0f, 1.0f) : 0.0f;
        float rampLocalY = r.startY + (r.endY - r.startY) * t;
        candY[candCount] = baseTerrainY + rampLocalY * b.scale;
        candIsRamp[candCount] = true;
        candCount++;
      }
    }

    float stepTol = 0.72f * c_fmaxf(1.0f, b.scale * 0.7f);
    for (int32_t ci = 0; ci < candCount; ci++) {
      float cY = candY[ci];
      if (cY <= currentY + stepTol) {
        float d = c_fabsf(currentY - cY);
        float bias = candIsRamp[ci] ? -0.85f : (cY > terrainY + 0.05f ? -0.18f : 0.0f);
        if (d + bias < bestDist) {
          bestDist = d + bias;
          bestY = cY;
        }
      }
    }
  }

  return bestY;
}

BuildingLocResult get_building_at_position(float x, float z, float y) {
  for (int32_t bi = 0; bi < g_building_count; bi++) {
    const EnterableBuilding& b = g_buildings[bi];
    float dx = x - b.x;
    float dz = z - b.z;
    if (dx * dx + dz * dz > b.footprintRadius * b.footprintRadius) continue;

    float baseTerrainY = ground_height_at(b.x, b.z);
    float localY = (y - baseTerrainY) / b.scale;
    float lx = 0.0f, lz = 0.0f;
    world_to_building_local(b, x, z, lx, lz);

    for (int32_t ri = 0; ri < b.rampCount; ri++) {
      const RampZone& r = b.ramps[ri];
      if (lx >= r.minX && lx <= r.maxX && lz >= r.minZ && lz <= r.maxZ) {
        return {bi, b.id, 1, ri, r.isInterior, r.isInterior};
      }
    }

    int32_t matchedFloorIdx = -1;
    float matchedElev = -1e6f;
    for (int32_t fi = 0; fi < b.floorCount; fi++) {
      const FloorZone& f = b.floors[fi];
      if (lx >= f.minX && lx <= f.maxX && lz >= f.minZ && lz <= f.maxZ) {
        if (localY >= f.elevation - 0.55f) {
          if (matchedFloorIdx < 0 || f.elevation > matchedElev) {
            matchedFloorIdx = fi;
            matchedElev = f.elevation;
          }
        }
      }
    }
    if (matchedFloorIdx >= 0) {
      const FloorZone& mf = b.floors[matchedFloorIdx];
      uint8_t hideRoof = (mf.isInterior && !mf.isRoof) ? 1 : 0;
      return {bi, b.id, 2, matchedFloorIdx, mf.isInterior, hideRoof};
    }
  }

  int32_t vIdx = find_village_at(x, z, 0.0f);
  if (vIdx >= 0) {
    return {-1, -1, 3, vIdx, 0, 0};
  }
  if (c_hypotf(x, z) < 28.0f) {
    return {-1, -1, 4, 0, 0, 0};
  }
  return {-1, -1, (z < -40.0f ? 5 : 6), 0, 0, 0};
}

CollisionResult resolve_building_wall_collision(float x, float y, float z, float radius) {
  float outX = x;
  float outZ = z;
  int32_t collided = 0;
  float normX = 0.0f;
  float normZ = 0.0f;

  for (int32_t bi = 0; bi < g_building_count; bi++) {
    const EnterableBuilding& b = g_buildings[bi];
    float dx = outX - b.x;
    float dz = outZ - b.z;
    if (dx * dx + dz * dz > b.footprintRadius * b.footprintRadius) continue;

    float baseTerrainY = ground_height_at(b.x, b.z);
    float localY = (y - baseTerrainY) / b.scale;
    float localR = c_fmaxf(0.12f, radius / b.scale);
    float lx = 0.0f, lz = 0.0f;
    world_to_building_local(b, outX, outZ, lx, lz);

    bool localHit = false;
    float lnx = 0.0f;
    float lnz = 0.0f;

    for (int32_t wi = 0; wi < b.wallCount; wi++) {
      const WallBox& w = b.walls[wi];
      if (localY + 0.2f < w.minY || localY - 0.25f > w.maxY) continue;

      float closestX = c_fmaxf(w.minX, c_fminf(lx, w.maxX));
      float closestZ = c_fmaxf(w.minZ, c_fminf(lz, w.maxZ));
      float ddx = lx - closestX;
      float ddz = lz - closestZ;
      float distSq = ddx * ddx + ddz * ddz;

      if (distSq < localR * localR) {
        localHit = true;
        if (distSq > 1e-7f) {
          float dist = c_sqrtf(distSq);
          float nx = ddx / dist;
          float nz = ddz / dist;
          float push = localR - dist;
          lx += nx * push;
          lz += nz * push;
          lnx += nx;
          lnz += nz;
        } else {
          float penLeft = lx - w.minX;
          float penRight = w.maxX - lx;
          float penTop = lz - w.minZ;
          float penBot = w.maxZ - lz;
          float minPen = c_fminf(c_fminf(penLeft, penRight), c_fminf(penTop, penBot));
          if (minPen == penLeft) {
            lx = w.minX - localR;
            lnx -= 1.0f;
          } else if (minPen == penRight) {
            lx = w.maxX + localR;
            lnx += 1.0f;
          } else if (minPen == penTop) {
            lz = w.minZ - localR;
            lnz -= 1.0f;
          } else {
            lz = w.maxZ + localR;
            lnz += 1.0f;
          }
        }
      }
    }

    if (localHit) {
      collided = 1;
      building_local_to_world(b, lx, lz, outX, outZ);
      float c = c_cosf(b.rotation);
      float s = c_sinf(b.rotation);
      normX += lnx * c + lnz * s;
      normZ += -lnx * s + lnz * c;
    }
  }

  float nLen = c_hypotf(normX, normZ);
  if (nLen > 1e-6f) {
    normX /= nLen;
    normZ /= nLen;
  }

  return {outX, outZ, collided, normX, normZ};
}

CollisionResult resolve_world_walls_collision(float x, float y, float z, float radius) {
  float outX = x;
  float outZ = z;
  int32_t collided = 0;
  float normX = 0.0f;
  float normZ = 0.0f;

  for (int32_t wi = 0; wi < g_fence_count; wi++) {
    const WallBox& w = g_fence_walls[wi];
    if (y + 0.2f < w.minY || y - 0.25f > w.maxY) continue;
    float closestX = c_fmaxf(w.minX, c_fminf(outX, w.maxX));
    float closestZ = c_fmaxf(w.minZ, c_fminf(outZ, w.maxZ));
    float ddx = outX - closestX;
    float ddz = outZ - closestZ;
    float distSq = ddx * ddx + ddz * ddz;

    if (distSq < radius * radius) {
      collided = 1;
      if (distSq > 1e-7f) {
        float dist = c_sqrtf(distSq);
        float nx = ddx / dist;
        float nz = ddz / dist;
        outX += nx * (radius - dist);
        outZ += nz * (radius - dist);
        normX += nx;
        normZ += nz;
      } else {
        float penLeft = outX - w.minX;
        float penRight = w.maxX - outX;
        float penTop = outZ - w.minZ;
        float penBot = w.maxZ - outZ;
        float minPen = c_fminf(c_fminf(penLeft, penRight), c_fminf(penTop, penBot));
        if (minPen == penLeft) {
          outX = w.minX - radius;
          normX -= 1.0f;
        } else if (minPen == penRight) {
          outX = w.maxX + radius;
          normX += 1.0f;
        } else if (minPen == penTop) {
          outZ = w.minZ - radius;
          normZ -= 1.0f;
        } else {
          outZ = w.maxZ + radius;
          normZ += 1.0f;
        }
      }
    }
  }

  float nLen = c_hypotf(normX, normZ);
  if (nLen > 1e-6f) {
    normX /= nLen;
    normZ /= nLen;
  }

  return {outX, outZ, collided, normX, normZ};
}

bool is_point_near_building(float x, float z, float padding) {
  for (int32_t bi = 0; bi < g_building_count; bi++) {
    const EnterableBuilding& b = g_buildings[bi];
    if (c_hypotf(x - b.x, z - b.z) < b.footprintRadius + padding) {
      return true;
    }
  }
  return false;
}

} // namespace serpentis
