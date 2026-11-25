#pragma once
#include <stdint.h>
#include "math_core.hpp"
#include "game_simulation.hpp"

namespace serpentis {

static constexpr int32_t PARTICLE_POOL_SIZE = 96;

struct ParticleSlot {
  int32_t active;
  float x, y, z;
  float vx, vy, vz;
  float life, maxLife, size;
  float r, g, b;
};

struct ProceduralBuffers {
  // Snake & mesh deformation outputs
  float poseIn[256 * 5];      // [x, y, z, yaw, radius]
  float spineIn[2048 * 4];    // [x, y, z, dist]
  float ringPts[256 * 4];
  float posOut[4096 * 3];
  float normOut[4096 * 3];
  float scratchOut[16];

  // InstancedMesh direct Matrix4 & Color buffers
  float shadowMats[MAX_SEGMENTS * 16];
  ParticleSlot particles[PARTICLE_POOL_SIZE];
  int32_t particleCursor;
  float particleMats[PARTICLE_POOL_SIZE * 16];
  float particleColors[PARTICLE_POOL_SIZE * 3];

  // Camera solver state: [camX, camY, camZ, lookX, lookY, lookZ, outPosX, outPosY, outPosZ, fov, trauma]
  float camState[16];

  // Terrain / Image processing shared pixel buffer
  float terrainOut[128 * 128];
  uint8_t pixelBuf[512 * 512 * 4];
  uint8_t pixelOut[512 * 512 * 4];
};

extern ProceduralBuffers g_proc;

void proc_init();
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
    float swallowBulgeT = 0.0f);

void proc_write_snake_shadow_mats(int32_t segCount);
void proc_spawn_particle_burst(float x, float y, float z, uint32_t hexColor, int32_t count, float speedScale);
int32_t proc_step_particles(float dt);
void proc_snap_camera(int32_t phase, float baseFov);
void proc_step_camera(float dt, float elapsed, float baseFov, float traumaAdd);
void proc_fill_terrain_heights(int32_t segs, float worldSize);
void proc_sobel_height_to_normal(int32_t w, int32_t h, float strength);

} // namespace serpentis
