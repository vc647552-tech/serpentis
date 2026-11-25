#include "procedural_gen.hpp"
#include "world_buildings.hpp"

namespace serpentis {

ProceduralBuffers g_proc;
static SeededRng g_cam_rng;

void proc_init() {
  g_cam_rng.reset(9191u);
  g_proc.particleCursor = 0;
  for (int32_t i = 0; i < PARTICLE_POOL_SIZE; i++) {
    g_proc.particles[i].active = 0;
    mat4_write_zero(&g_proc.particleMats[i * 16]);
    g_proc.particleColors[i * 3] = 1.0f;
    g_proc.particleColors[i * 3 + 1] = 1.0f;
    g_proc.particleColors[i * 3 + 2] = 1.0f;
  }
  g_proc.camState[0] = 0.0f;
  g_proc.camState[1] = 5.2f;
  g_proc.camState[2] = 12.0f;
  g_proc.camState[3] = 0.0f;
  g_proc.camState[4] = 0.4f;
  g_proc.camState[5] = 2.0f;
  g_proc.camState[6] = 0.0f;
  g_proc.camState[7] = 5.2f;
  g_proc.camState[8] = 12.0f;
  g_proc.camState[9] = 54.0f;
  g_proc.camState[10] = 0.0f;
}

void proc_deform_snake_from_poses(
    const float* poses,
    float headX,
    float headY,
    float headZ,
    float heading,
    float headPitch,
    int32_t poseCount,
    int32_t rings,
    int32_t radial,
    float elapsed,
    float headWidth,
    float headHeight,
    float bodyWidth,
    float bodyHeight,
    float hoodStrength,
    float segSpacing,
    float headRadius,
    float swallowBulgeT) {
  if (poseCount < 3 || rings <= 1 || radial <= 2) return;
  if (rings > 250) rings = 250;
  int32_t stride = radial + 1;
  int32_t vertCount = (rings + 1) * stride;
  if (vertCount > 4096) return;

  float scaleRatio = segSpacing / SEGMENT_SPACING;
  float cosP = c_cosf(headPitch);
  float f0x = c_sinf(heading) * cosP;
  float f0y = -c_sinf(headPitch);
  float f0z = c_cosf(heading) * cosP;

  float p0x = headX + f0x * 0.02f * scaleRatio;
  float p0y = headY + f0y * 0.02f * scaleRatio - 0.008f * scaleRatio;
  float p0z = headZ + f0z * 0.02f * scaleRatio;
  float neckRad =
      c_fabsf(segSpacing - SEGMENT_SPACING) < 1e-4f
          ? headRadius * 0.68f
          : c_fmaxf(0.05f, poses[4] * 0.92f);

  float b0x = -f0x;
  float b0y = -f0y;
  float b0z = -f0z;

  int32_t joinIdx = poseCount - 1 < 2 ? poseCount - 1 : 2;
  float hermiteLen = static_cast<float>(joinIdx + 1) * segSpacing;

  int32_t p1Off = joinIdx * 5;
  float p1x = poses[p1Off];
  float p1y = poses[p1Off + 1];
  float p1z = poses[p1Off + 2];
  float p1Rad = poses[p1Off + 4];

  int32_t prevOff = (joinIdx > 0 ? joinIdx - 1 : 0) * 5;
  int32_t nextOff = (joinIdx + 1 < poseCount ? joinIdx + 1 : poseCount - 1) * 5;
  float b1x = poses[nextOff] - poses[prevOff];
  float b1y = poses[nextOff + 1] - poses[prevOff + 1];
  float b1z = poses[nextOff + 2] - poses[prevOff + 2];
  float b1Len = c_sqrtf(b1x * b1x + b1y * b1y + b1z * b1z);
  if (b1Len < 1e-5f) b1Len = 1.0f;
  b1x /= b1Len;
  b1y /= b1Len;
  b1z /= b1Len;

  float dx01 = p1x - p0x;
  float dy01 = p1y - p0y;
  float dz01 = p1z - p0z;
  float chordLen = c_sqrtf(dx01 * dx01 + dy01 * dy01 + dz01 * dz01);
  float tangLen = c_fminf(hermiteLen, c_fmaxf(segSpacing * 0.45f, chordLen * 0.88f));
  if (chordLen > 1e-4f) {
    float cdx = dx01 / chordLen;
    float cdy = dy01 / chordLen;
    float cdz = dz01 / chordLen;
    float align = b0x * cdx + b0y * cdy + b0z * cdz;
    if (align < 0.05f) {
      float blend = c_clampf((0.05f - align) * 0.72f, 0.0f, 0.78f);
      b0x += (cdx - b0x) * blend;
      b0y += (cdy - b0y) * blend;
      b0z += (cdz - b0z) * blend;
      float b0L = c_sqrtf(b0x * b0x + b0y * b0y + b0z * b0z);
      if (b0L > 1e-5f) {
        b0x /= b0L;
        b0y /= b0L;
        b0z /= b0L;
      }
      tangLen = c_fminf(tangLen, c_fmaxf(segSpacing * 0.42f, chordLen * 0.65f));
    }
  }

  float totalLen = static_cast<float>(poseCount) * segSpacing;
  float bulgeCenter = 0.08f + (1.0f - swallowBulgeT) * 0.70f;

  for (int32_t r = 0; r <= rings; r++) {
    float t = static_cast<float>(r) / static_cast<float>(rings);
    float distBack = t * totalLen;
    int32_t r4 = r * 4;

    float bulgeMult = 1.0f;
    if (swallowBulgeT > 0.001f) {
      float dT = (t - bulgeCenter) / 0.085f;
      bulgeMult = 1.0f + swallowBulgeT * c_expf(-dT * dT) * 0.62f;
    }

    if (distBack <= hermiteLen) {
      float u = distBack / hermiteLen;
      float u2 = u * u;
      float u3 = u2 * u;
      float h00 = 2.0f * u3 - 3.0f * u2 + 1.0f;
      float h10 = u3 - 2.0f * u2 + u;
      float h01 = -2.0f * u3 + 3.0f * u2;
      float h11 = u3 - u2;

      g_proc.ringPts[r4]     = h00 * p0x + h10 * tangLen * b0x + h01 * p1x + h11 * tangLen * b1x;
      g_proc.ringPts[r4 + 1] = h00 * p0y + h10 * tangLen * b0y + h01 * p1y + h11 * tangLen * b1y;
      g_proc.ringPts[r4 + 2] = h00 * p0z + h10 * tangLen * b0z + h01 * p1z + h11 * tangLen * b1z;
      float smoothU = u2 * (3.0f - 2.0f * u);
      g_proc.ringPts[r4 + 3] = (neckRad + (p1Rad - neckRad) * smoothU) * bulgeMult;
    } else {
      float segFloat = distBack / segSpacing - 1.0f;
      int32_t i0 = static_cast<int32_t>(segFloat);
      if (i0 < 0) i0 = 0;
      if (i0 > poseCount - 1) i0 = poseCount - 1;
      int32_t i1 = i0 + 1 < poseCount ? i0 + 1 : poseCount - 1;
      float alpha = c_clampf(segFloat - static_cast<float>(i0), 0.0f, 1.0f);

      int32_t a0 = i0 * 5;
      int32_t a1 = i1 * 5;
      g_proc.ringPts[r4]     = poses[a0]     + (poses[a1]     - poses[a0])     * alpha;
      g_proc.ringPts[r4 + 1] = poses[a0 + 1] + (poses[a1 + 1] - poses[a0 + 1]) * alpha;
      g_proc.ringPts[r4 + 2] = poses[a0 + 2] + (poses[a1 + 2] - poses[a0 + 2]) * alpha;

      float baseRad = poses[a0 + 4] + (poses[a1 + 4] - poses[a0 + 4]) * alpha;
      float tailFade = t > 0.88f ? c_fmaxf(0.035f, 1.0f - (t - 0.88f) / 0.12f) : 1.0f;
      float breath = (t > 0.08f && t < 0.6f) ? 1.0f + c_sinf(elapsed * 2.4f - t * 4.0f) * 0.025f : 1.0f;
      g_proc.ringPts[r4 + 3] = baseRad * tailFade * breath * bulgeMult;
    }
  }

  float prevRx = 1.0f, prevRz = 0.0f;
  for (int32_t r = 0; r <= rings; r++) {
    int32_t r4 = r * 4;
    float distBack = (static_cast<float>(r) / static_cast<float>(rings)) * totalLen;
    float cx = g_proc.ringPts[r4];
    float cy = g_proc.ringPts[r4 + 1];
    float cz = g_proc.ringPts[r4 + 2];
    float rad = g_proc.ringPts[r4 + 3];

    float tx, ty, tz;
    if (r == 0) {
      tx = b0x; ty = b0y; tz = b0z;
    } else {
      int32_t prev4 = (r - 1) * 4;
      int32_t next4 = (r + 1 <= rings ? r + 1 : rings) * 4;
      tx = g_proc.ringPts[next4]     - g_proc.ringPts[prev4];
      ty = g_proc.ringPts[next4 + 1] - g_proc.ringPts[prev4 + 1];
      tz = g_proc.ringPts[next4 + 2] - g_proc.ringPts[prev4 + 2];
      float tLen = c_sqrtf(tx * tx + ty * ty + tz * tz);
      if (tLen < 1e-5f) {
        tx = b0x; ty = b0y; tz = b0z;
      } else {
        tx /= tLen; ty /= tLen; tz /= tLen;
      }
    }

    float rx = tz;
    float rz = -tx;
    float rLen = c_hypotf(rx, rz);
    if (rLen < 1e-5f) {
      rx = prevRx; rz = prevRz;
    } else {
      rx /= rLen; rz /= rLen;
      prevRx = rx; prevRz = rz;
    }

    float ux = ty * rz;
    float uy = tz * rx - tx * rz;
    float uz = -ty * rx;

    float hoodBell = 0.0f;
    if (hoodStrength > 0.0f && distBack > 0.22f * scaleRatio && distBack < 2.15f * scaleRatio) {
      float hu = (distBack - 0.22f * scaleRatio) / (1.93f * scaleRatio);
      hoodBell = c_pow_sin_hu(hu);
    }

    float neckDenom = c_fmaxf(0.18f, 0.9f * scaleRatio);
    float neckMorphT = c_fminf(1.0f, distBack / neckDenom);
    float curW = headWidth * 0.92f + (bodyWidth - headWidth * 0.92f) * neckMorphT;
    float curH = headHeight * 0.92f + (bodyHeight - headHeight * 0.92f) * neckMorphT;
    float hasHood = hoodStrength > 0.0f ? 1.0f : 0.0f;

    for (int32_t s = 0; s <= radial; s++) {
      float theta = (static_cast<float>(s) / static_cast<float>(radial)) * TWO_PI;
      float sinT = c_sinf(theta);
      float cosT = -c_cosf(theta);

      float baseW = (cosT < -0.15f ? 1.16f : 1.06f) * curW;
      float hoodW = 1.0f + hoodStrength * hoodBell * (cosT > -0.3f ? 1.0f : 0.72f);
      float hoodH = 1.0f - 0.34f * hoodBell * hasHood;

      float widthFactor = baseW * hoodW;
      float heightFactor = (cosT < -0.15f ? 0.46f : 0.9f + c_fmaxf(0.0f, cosT) * 0.04f) * curH * hoodH;

      float lx = sinT * rad * widthFactor;
      float ly = cosT * rad * heightFactor;

      int32_t outIdx = (r * stride + s) * 3;
      g_proc.posOut[outIdx]     = cx + rx * lx + ux * ly;
      g_proc.posOut[outIdx + 1] = cy + uy * ly;
      g_proc.posOut[outIdx + 2] = cz + rz * lx + uz * ly;

      g_proc.normOut[outIdx] = 0.0f;
      g_proc.normOut[outIdx + 1] = 0.0f;
      g_proc.normOut[outIdx + 2] = 0.0f;
    }
  }

  for (int32_t r = 0; r < rings; r++) {
    for (int32_t s = 0; s < radial; s++) {
      int32_t a = (r * stride + s) * 3;
      int32_t b = a + 3;
      int32_t c = ((r + 1) * stride + s) * 3;
      int32_t d = c + 3;

      float abx = g_proc.posOut[b]     - g_proc.posOut[a];
      float aby = g_proc.posOut[b + 1] - g_proc.posOut[a + 1];
      float abz = g_proc.posOut[b + 2] - g_proc.posOut[a + 2];
      float acx = g_proc.posOut[c]     - g_proc.posOut[a];
      float acy = g_proc.posOut[c + 1] - g_proc.posOut[a + 1];
      float acz = g_proc.posOut[c + 2] - g_proc.posOut[a + 2];
      float n1x = aby * acz - abz * acy;
      float n1y = abz * acx - abx * acz;
      float n1z = abx * acy - aby * acx;

      g_proc.normOut[a] += n1x; g_proc.normOut[a + 1] += n1y; g_proc.normOut[a + 2] += n1z;
      g_proc.normOut[b] += n1x; g_proc.normOut[b + 1] += n1y; g_proc.normOut[b + 2] += n1z;
      g_proc.normOut[c] += n1x; g_proc.normOut[c + 1] += n1y; g_proc.normOut[c + 2] += n1z;

      float bdx = g_proc.posOut[d]     - g_proc.posOut[b];
      float bdy = g_proc.posOut[d + 1] - g_proc.posOut[b + 1];
      float bdz = g_proc.posOut[d + 2] - g_proc.posOut[b + 2];
      float bcx = g_proc.posOut[c]     - g_proc.posOut[b];
      float bcy = g_proc.posOut[c + 1] - g_proc.posOut[b + 1];
      float bcz = g_proc.posOut[c + 2] - g_proc.posOut[b + 2];
      float n2x = bdy * bcz - bdz * bcy;
      float n2y = bdz * bcx - bdx * bcz;
      float n2z = bdx * bcy - bdy * bcx;

      g_proc.normOut[b] += n2x; g_proc.normOut[b + 1] += n2y; g_proc.normOut[b + 2] += n2z;
      g_proc.normOut[d] += n2x; g_proc.normOut[d + 1] += n2y; g_proc.normOut[d + 2] += n2z;
      g_proc.normOut[c] += n2x; g_proc.normOut[c + 1] += n2y; g_proc.normOut[c + 2] += n2z;
    }
  }

  for (int32_t r = 0; r <= rings; r++) {
    int32_t first = (r * stride) * 3;
    int32_t last = (r * stride + radial) * 3;
    float sx = g_proc.normOut[first]     + g_proc.normOut[last];
    float sy = g_proc.normOut[first + 1] + g_proc.normOut[last + 1];
    float sz = g_proc.normOut[first + 2] + g_proc.normOut[last + 2];
    g_proc.normOut[first]     = g_proc.normOut[last]     = sx;
    g_proc.normOut[first + 1] = g_proc.normOut[last + 1] = sy;
    g_proc.normOut[first + 2] = g_proc.normOut[last + 2] = sz;
  }

  for (int32_t i = 0; i < vertCount; i++) {
    int32_t idx = i * 3;
    float nx = g_proc.normOut[idx];
    float ny = g_proc.normOut[idx + 1];
    float nz = g_proc.normOut[idx + 2];
    float len = c_sqrtf(nx * nx + ny * ny + nz * nz);
    if (len > 1e-6f) {
      float inv = 1.0f / len;
      g_proc.normOut[idx]     = nx * inv;
      g_proc.normOut[idx + 1] = ny * inv;
      g_proc.normOut[idx + 2] = nz * inv;
    } else {
      g_proc.normOut[idx]     = 0.0f;
      g_proc.normOut[idx + 1] = 1.0f;
      g_proc.normOut[idx + 2] = 0.0f;
    }
  }

  int32_t rLast4 = rings * 4;
  int32_t rPrev4 = (rings - 1) * 4;
  g_proc.scratchOut[0] = g_proc.ringPts[rLast4];
  g_proc.scratchOut[1] = g_proc.ringPts[rLast4 + 1];
  g_proc.scratchOut[2] = g_proc.ringPts[rLast4 + 2];
  g_proc.scratchOut[3] = c_atan2f(
      g_proc.ringPts[rPrev4] - g_proc.ringPts[rLast4],
      g_proc.ringPts[rPrev4 + 2] - g_proc.ringPts[rLast4 + 2]);
}

void proc_write_snake_shadow_mats(int32_t segCount) {
  if (segCount > MAX_SEGMENTS) segCount = MAX_SEGMENTS;
  for (int32_t i = 0; i < segCount; i++) {
    const float* p = &g_sim.playerPoses[i * 5];
    float sRad = p[4] * 1.48f;
    mat4_write_shadow_disc(&g_proc.shadowMats[i * 16], p[0], p[1] - p[4] * 0.56f + 0.018f, p[2], sRad);
  }
}

void proc_spawn_particle_burst(float x, float y, float z, uint32_t hexColor, int32_t count, float speedScale) {
  float cr = static_cast<float>((hexColor >> 16) & 0xFF) / 255.0f;
  float cg = static_cast<float>((hexColor >> 8) & 0xFF) / 255.0f;
  float cb = static_cast<float>(hexColor & 0xFF) / 255.0f;
  cr = cr <= 0.04045f ? cr / 12.92f : cr * cr * (0.45f + 0.55f * cr);
  cg = cg <= 0.04045f ? cg / 12.92f : cg * cg * (0.45f + 0.55f * cg);
  cb = cb <= 0.04045f ? cb / 12.92f : cb * cb * (0.45f + 0.55f * cb);

  for (int32_t i = 0; i < count; i++) {
    int32_t idx = g_proc.particleCursor;
    g_proc.particleCursor = (g_proc.particleCursor + 1) % PARTICLE_POOL_SIZE;
    ParticleSlot& slot = g_proc.particles[idx];
    float angle = g_cam_rng.next() * TWO_PI;
    float spd = (0.35f + g_cam_rng.next() * 0.75f) * speedScale;
    slot.active = 1;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = c_cosf(angle) * spd;
    slot.vy = 1.6f + g_cam_rng.next() * 3.4f;
    slot.vz = c_sinf(angle) * spd;
    slot.life = 0.0f;
    slot.maxLife = 0.42f + g_cam_rng.next() * 0.38f;
    slot.size = 0.7f + g_cam_rng.next() * 0.9f;
    slot.r = cr;
    slot.g = cg;
    slot.b = cb;
  }
}

int32_t proc_step_particles(float dt) {
  int32_t dirty = 0;
  for (int32_t i = 0; i < PARTICLE_POOL_SIZE; i++) {
    ParticleSlot& p = g_proc.particles[i];
    if (!p.active) continue;
    dirty = 1;
    p.life += dt;
    if (p.life >= p.maxLife) {
      p.active = 0;
      mat4_write_zero(&g_proc.particleMats[i * 16]);
      continue;
    }
    p.vy -= 9.8f * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;

    float t = 1.0f - p.life / p.maxLife;
    float s = p.size * t;
    mat4_write_pos_scale(&g_proc.particleMats[i * 16], p.x, p.y, p.z, s);
    g_proc.particleColors[i * 3]     = p.r;
    g_proc.particleColors[i * 3 + 1] = p.g;
    g_proc.particleColors[i * 3 + 2] = p.b;
  }
  return dirty;
}

void proc_snap_camera(int32_t phase, float baseFov) {
  float sc = c_clampf(g_sim.scalars.snakeScale, START_SNAKE_SCALE, MAX_SNAKE_SCALE);
  float camZoom = 0.72f + sc * 0.34f;
  float hx = g_sim.scalars.headX;
  float hy = g_sim.scalars.headY + 0.42f * sc;
  float hz = g_sim.scalars.headZ;

  if (phase == PHASE_TITLE) {
    g_proc.camState[0] = hx + 4.0f;
    g_proc.camState[1] = hy + 2.6f;
    g_proc.camState[2] = hz + 4.8f;
    g_proc.camState[3] = hx - 1.3f;
    g_proc.camState[4] = hy + 0.42f;
    g_proc.camState[5] = hz - 2.2f;
    g_proc.camState[9] = c_fmaxf(46.0f, baseFov - 4.0f);
  } else if (g_sim.scalars.cameraMode == CAM_CANOPY) {
    g_proc.camState[0] = hx;
    g_proc.camState[1] = 34.0f + hy * 0.45f;
    g_proc.camState[2] = hz + 24.0f;
    g_proc.camState[3] = hx;
    g_proc.camState[4] = hy + 0.5f;
    g_proc.camState[5] = hz - 4.0f;
    g_proc.camState[9] = c_fmaxf(46.0f, baseFov - 4.0f);
  } else {
    float dirX = c_sinf(g_sim.scalars.heading);
    float dirZ = c_cosf(g_sim.scalars.heading);
    g_proc.camState[0] = hx - dirX * 6.2f * camZoom;
    g_proc.camState[1] = hy + 4.4f * camZoom;
    g_proc.camState[2] = hz - dirZ * 6.2f * camZoom;
    g_proc.camState[3] = hx + dirX * 4.0f;
    g_proc.camState[4] = hy + 0.32f;
    g_proc.camState[5] = hz + dirZ * 4.0f;
    g_proc.camState[9] = baseFov;
  }
  g_proc.camState[6] = g_proc.camState[0];
  g_proc.camState[7] = g_proc.camState[1];
  g_proc.camState[8] = g_proc.camState[2];
}

void proc_step_camera(float dt, float elapsed, float baseFov, float traumaAdd) {
  if (traumaAdd > 0.0f) {
    g_proc.camState[10] = c_fminf(1.0f, g_proc.camState[10] + traumaAdd);
  }
  float sc = c_clampf(g_sim.scalars.snakeScale, START_SNAKE_SCALE, MAX_SNAKE_SCALE);
  float camZoom = 0.72f + sc * 0.34f;
  float hx = g_sim.scalars.headX;
  float headY = g_sim.scalars.headY + 0.42f * sc;
  float hz = g_sim.scalars.headZ;

  float tx, ty, tz, lx, ly, lz, targetFov;
  if (g_sim.scalars.phase == PHASE_TITLE) {
    float orbitAngle = 0.68f + c_sinf(elapsed * 0.22f) * 0.32f;
    tx = hx + c_sinf(orbitAngle) * 6.2f;
    ty = headY + 2.55f + c_sinf(elapsed * 0.35f) * 0.18f;
    tz = hz + c_cosf(orbitAngle) * 6.2f;
    float rightX = c_cosf(orbitAngle);
    float rightZ = -c_sinf(orbitAngle);
    lx = hx - rightX * 1.4f - 0.5f;
    ly = headY + 0.35f;
    lz = hz - rightZ * 1.4f - 1.8f;
    targetFov = c_fmaxf(46.0f, baseFov - 4.0f);
  } else if (g_sim.scalars.cameraMode == CAM_CANOPY) {
    tx = hx;
    ty = 34.0f + g_sim.scalars.headY * 0.45f;
    tz = hz + 24.0f;
    lx = hx;
    ly = g_sim.scalars.headY + 0.5f;
    lz = hz - 4.0f;
    targetFov = c_fmaxf(46.0f, baseFov - 4.0f);
  } else {
    bool ind = g_sim.scalars.isIndoors != 0;
    bool bst = g_sim.scalars.isBoosting != 0;
    float backDist = (ind ? 5.8f : (bst ? 7.2f : 6.2f)) * camZoom;
    float height = (ind ? 5.2f : (bst ? 4.4f : 4.7f)) * camZoom;
    float dirX = c_sinf(g_sim.scalars.heading);
    float dirZ = c_cosf(g_sim.scalars.heading);
    tx = hx - dirX * backDist;
    ty = headY + height;
    tz = hz - dirZ * backDist;
    lx = hx + dirX * (ind ? 2.6f : 2.8f);
    ly = headY + 0.15f;
    lz = hz + dirZ * (ind ? 2.6f : 2.8f);
    targetFov = bst ? baseFov + 7.0f : baseFov;
  }

  float damp = 1.0f - c_expf(-6.5f * dt);
  g_proc.camState[0] += (tx - g_proc.camState[0]) * damp;
  g_proc.camState[1] += (ty - g_proc.camState[1]) * damp;
  g_proc.camState[2] += (tz - g_proc.camState[2]) * damp;
  g_proc.camState[3] += (lx - g_proc.camState[3]) * damp;
  g_proc.camState[4] += (ly - g_proc.camState[4]) * damp;
  g_proc.camState[5] += (lz - g_proc.camState[5]) * damp;

  float camGround = ground_height_at(g_proc.camState[0], g_proc.camState[2]) + 1.4f;
  if (g_proc.camState[1] < camGround) g_proc.camState[1] = camGround;

  g_proc.camState[10] = c_fmaxf(0.0f, g_proc.camState[10] - 1.9f * dt);
  float trm = g_proc.camState[10];
  float shake = trm * trm * 0.38f;
  float shakeX = (g_cam_rng.next() * 2.0f - 1.0f) * shake;
  float shakeY = (g_cam_rng.next() * 2.0f - 1.0f) * shake;

  g_proc.camState[6] = g_proc.camState[0] + shakeX;
  g_proc.camState[7] = g_proc.camState[1] + shakeY;
  g_proc.camState[8] = g_proc.camState[2];

  float fovDamp = 1.0f - c_expf(-6.0f * dt);
  g_proc.camState[9] += (targetFov - g_proc.camState[9]) * fovDamp;
}

void proc_fill_terrain_heights(int32_t segs, float worldSize) {
  int32_t n = segs + 1;
  if (n > 128) return;
  float half = worldSize * 0.5f;
  float step = worldSize / static_cast<float>(segs);
  for (int32_t iz = 0; iz < n; iz++) {
    float z = -half + static_cast<float>(iz) * step;
    for (int32_t ix = 0; ix < n; ix++) {
      float x = -half + static_cast<float>(ix) * step;
      g_proc.terrainOut[iz * n + ix] = ground_height_at(x, z);
    }
  }
}

void proc_sobel_height_to_normal(int32_t w, int32_t h, float strength) {
  if (w <= 0 || h <= 0 || w * h > 512 * 512) return;
  const uint8_t* src = g_proc.pixelBuf;
  uint8_t* dst = g_proc.pixelOut;
  constexpr float INV_255 = 1.0f / 255.0f;

  auto sample = [&](int32_t x, int32_t y) -> float {
    int32_t wx = (x % w + w) % w;
    int32_t wy = (y % h + h) % h;
    return static_cast<float>(src[(wy * w + wx) * 4]) * INV_255;
  };

  for (int32_t y = 0; y < h; y++) {
    for (int32_t x = 0; x < w; x++) {
      float tl = sample(x - 1, y - 1);
      float t  = sample(x,     y - 1);
      float tr = sample(x + 1, y - 1);
      float l  = sample(x - 1, y);
      float r  = sample(x + 1, y);
      float bl = sample(x - 1, y + 1);
      float b  = sample(x,     y + 1);
      float br = sample(x + 1, y + 1);

      float dx = (tr + 2.0f * r + br - (tl + 2.0f * l + bl)) * strength;
      float dy = (bl + 2.0f * b + br - (tl + 2.0f * t + tr)) * strength;
      float invLen = 1.0f / c_sqrtf(dx * dx + dy * dy + 1.0f);

      int32_t idx = (y * w + x) * 4;
      dst[idx]     = static_cast<uint8_t>((-dx * invLen * 0.5f + 0.5f) * 255.0f + 0.5f);
      dst[idx + 1] = static_cast<uint8_t>((-dy * invLen * 0.5f + 0.5f) * 255.0f + 0.5f);
      dst[idx + 2] = static_cast<uint8_t>((1.0f * invLen * 0.5f + 0.5f) * 255.0f + 0.5f);
      dst[idx + 3] = 255;
    }
  }
}

} // namespace serpentis
