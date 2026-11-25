#include <stdint.h>
#include "math_core.hpp"
#include "world_buildings.hpp"
#include "game_simulation.hpp"
#include "procedural_gen.hpp"

using namespace serpentis;

extern "C" {

void* memset(void* dst, int val, unsigned long n) {
  unsigned char* p = static_cast<unsigned char*>(dst);
  unsigned char b = static_cast<unsigned char>(val);
  for (unsigned long i = 0; i < n; i++) p[i] = b;
  return dst;
}

void* memcpy(void* dst, const void* src, unsigned long n) {
  unsigned char* d = static_cast<unsigned char*>(dst);
  const unsigned char* s = static_cast<const unsigned char*>(src);
  for (unsigned long i = 0; i < n; i++) d[i] = s[i];
  return dst;
}

// Initialization & Simulation Lifecycle
void wasm_init(uint32_t seed) {
  sim_init(seed);
  proc_init();
}

void wasm_reset_world(int32_t isTitleDemo) {
  sim_reset_world(isTitleDemo != 0);
}

void wasm_start_game() {
  sim_start_game();
}

void wasm_set_phase(int32_t nextPhase) {
  sim_set_phase(nextPhase);
}

void wasm_toggle_pause() {
  sim_toggle_pause();
}

int32_t wasm_can_lay_egg() {
  return sim_can_lay_egg() ? 1 : 0;
}

int32_t wasm_lay_egg() {
  return sim_lay_egg() ? 1 : 0;
}

int32_t wasm_trigger_primary_power() {
  return sim_trigger_primary_power() ? 1 : 0;
}

int32_t wasm_trigger_tail_grab() {
  return sim_trigger_tail_grab() ? 1 : 0;
}

int32_t wasm_trigger_bite_action() {
  return sim_trigger_bite_action() ? 1 : 0;
}

int32_t wasm_trigger_secondary_power() {
  return sim_trigger_secondary_power() ? 1 : 0;
}

void wasm_step_title_demo(float dt) {
  sim_step_title_demo(dt);
}

void wasm_step_game(
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
  sim_step(dt, left, right, up, down, boost, steerAxis, moveThrottle, joyX, joyY);
}

void wasm_damage_snake(float amount, float sx, float sy, float sz) {
  sim_damage_snake(amount, sx, sy, sz);
}

void wasm_compute_segment_poses() {
  sim_compute_segment_poses();
}

void wasm_recompute_hatchling_poses(int32_t hIdx) {
  sim_recompute_hatchling_poses(hIdx);
}

void wasm_spawn_prey(
    int32_t hasKind,
    int32_t kind,
    int32_t hasPos,
    float x,
    float z,
    int32_t hasY,
    float y) {
  sim_spawn_prey(hasKind, kind, hasPos, x, z, hasY, y);
}

int32_t wasm_spawn_villager(int32_t role, float x, float z, int32_t tier, int32_t isElite, int32_t homeVillageId) {
  return sim_spawn_villager(role, x, z, tier, isElite, homeVillageId);
}

int32_t wasm_spawn_hatchling(float x, float y, float z) {
  return sim_spawn_hatchling(x, y, z);
}

void wasm_clear_events() {
  g_sim.eventCount = 0;
}

// Linear Memory Pointers for Zero-Copy TypedArray Bindings
void* wasm_get_scalars_ptr() { return &g_sim.scalars; }
void* wasm_get_counts_ptr() { return &g_sim.preyCount; }
void* wasm_get_prey_ptr() { return g_sim.prey; }
void* wasm_get_villagers_ptr() { return g_sim.villagers; }
void* wasm_get_eggs_ptr() { return g_sim.laidEggs; }
void* wasm_get_hatchlings_ptr() { return g_sim.hatchlings; }
void* wasm_get_hatchling_poses_ptr(int32_t hIdx) {
  if (hIdx < 0 || hIdx >= MAX_HATCHLING_POOL) return g_sim.hatchlingPoses[0];
  return g_sim.hatchlingPoses[hIdx];
}
void* wasm_get_hatchling_spines_ptr(int32_t hIdx) {
  if (hIdx < 0 || hIdx >= MAX_HATCHLING_POOL) return g_sim.hatchlingSpines[0];
  return g_sim.hatchlingSpines[hIdx];
}
void* wasm_get_projectiles_ptr() { return g_sim.projectiles; }
void* wasm_get_obstacles_ptr() { return g_sim.obstacles; }
void* wasm_get_trees_ptr() { return g_sim.trees; }
void* wasm_get_events_ptr() { return g_sim.events; }
void* wasm_get_player_spine_ptr() { return g_sim.playerSpineRing; }
int32_t wasm_get_player_spine_head_idx() { return g_sim.spineHeadIdx; }
void* wasm_get_player_poses_ptr() { return g_sim.playerPoses; }

void* wasm_get_pose_in_ptr() { return g_proc.poseIn; }
void* wasm_get_spine_in_ptr() { return g_proc.spineIn; }
void* wasm_get_pos_out_ptr() { return g_proc.posOut; }
void* wasm_get_norm_out_ptr() { return g_proc.normOut; }
void* wasm_get_scratch_ptr() { return g_proc.scratchOut; }

void* wasm_get_shadow_mats_ptr() { return g_proc.shadowMats; }
void* wasm_get_particle_mats_ptr() { return g_proc.particleMats; }
void* wasm_get_particle_colors_ptr() { return g_proc.particleColors; }
void* wasm_get_cam_state_ptr() { return g_proc.camState; }
void* wasm_get_terrain_out_ptr() { return g_proc.terrainOut; }
void* wasm_get_pixel_buf_ptr() { return g_proc.pixelBuf; }
void* wasm_get_pixel_out_ptr() { return g_proc.pixelOut; }

// Pure Geometry / Building / World Physics Exports
float wasm_ground_height(float x, float z) {
  return ground_height_at(x, z);
}

float wasm_surface_height_at(float x, float z, float currentY) {
  return surface_height_at(x, z, currentY);
}

void wasm_get_building_at_position(float x, float z, float y) {
  BuildingLocResult res = get_building_at_position(x, z, y);
  g_proc.scratchOut[0] = static_cast<float>(res.buildingIdx);
  g_proc.scratchOut[1] = static_cast<float>(res.buildingId);
  g_proc.scratchOut[2] = static_cast<float>(res.zoneType);
  g_proc.scratchOut[3] = static_cast<float>(res.zoneIdx);
  g_proc.scratchOut[4] = static_cast<float>(res.isIndoors);
  g_proc.scratchOut[5] = static_cast<float>(res.hideRoof);
}

int32_t wasm_resolve_building_wall_collision(float x, float y, float z, float radius) {
  CollisionResult r = resolve_building_wall_collision(x, y, z, radius);
  g_proc.scratchOut[0] = r.x;
  g_proc.scratchOut[1] = r.z;
  g_proc.scratchOut[2] = r.normalX;
  g_proc.scratchOut[3] = r.normalZ;
  return r.collided;
}

int32_t wasm_resolve_world_walls_collision(float x, float y, float z, float radius) {
  CollisionResult r = resolve_world_walls_collision(x, y, z, radius);
  g_proc.scratchOut[0] = r.x;
  g_proc.scratchOut[1] = r.z;
  g_proc.scratchOut[2] = r.normalX;
  g_proc.scratchOut[3] = r.normalZ;
  return r.collided;
}

int32_t wasm_is_point_near_building(float x, float z, float padding) {
  return is_point_near_building(x, z, padding) ? 1 : 0;
}

void wasm_sample_spine_at_distance(int32_t spineLen, float headTotalDist, float distBehind) {
  if (spineLen <= 0) {
    g_proc.scratchOut[0] = g_proc.scratchOut[1] = g_proc.scratchOut[2] = g_proc.scratchOut[3] = 0.0f;
    return;
  }
  float targetDist = c_fmaxf(0.0f, headTotalDist - distBehind);
  if (targetDist >= g_proc.spineIn[3] || spineLen == 1) {
    float p0x = g_proc.spineIn[0];
    float p0y = g_proc.spineIn[1];
    float p0z = g_proc.spineIn[2];
    float p1x = spineLen > 1 ? g_proc.spineIn[4] : p0x;
    float p1z = spineLen > 1 ? g_proc.spineIn[6] : p0z;
    g_proc.scratchOut[0] = p0x;
    g_proc.scratchOut[1] = p0y;
    g_proc.scratchOut[2] = p0z;
    g_proc.scratchOut[3] = c_atan2f(p0x - p1x, p0z - p1z);
    return;
  }
  for (int32_t i = 0; i < spineLen - 1; i++) {
    int32_t o = i * 4;
    int32_t n = (i + 1) * 4;
    float newerD = g_proc.spineIn[o + 3];
    float olderD = g_proc.spineIn[n + 3];
    if (targetDist <= newerD && targetDist >= olderD) {
      float span = newerD - olderD;
      float t = span > 1e-6f ? (targetDist - olderD) / span : 0.0f;
      g_proc.scratchOut[0] = g_proc.spineIn[n]     + (g_proc.spineIn[o]     - g_proc.spineIn[n])     * t;
      g_proc.scratchOut[1] = g_proc.spineIn[n + 1] + (g_proc.spineIn[o + 1] - g_proc.spineIn[n + 1]) * t;
      g_proc.scratchOut[2] = g_proc.spineIn[n + 2] + (g_proc.spineIn[o + 2] - g_proc.spineIn[n + 2]) * t;
      g_proc.scratchOut[3] = c_atan2f(g_proc.spineIn[o] - g_proc.spineIn[n], g_proc.spineIn[o + 2] - g_proc.spineIn[n + 2]);
      return;
    }
  }
  int32_t last = (spineLen - 1) * 4;
  int32_t prev = (spineLen > 1 ? spineLen - 2 : 0) * 4;
  g_proc.scratchOut[0] = g_proc.spineIn[last];
  g_proc.scratchOut[1] = g_proc.spineIn[last + 1];
  g_proc.scratchOut[2] = g_proc.spineIn[last + 2];
  g_proc.scratchOut[3] = c_atan2f(g_proc.spineIn[prev] - g_proc.spineIn[last], g_proc.spineIn[prev + 2] - g_proc.spineIn[last + 2]);
}

void wasm_deform_snake_body(
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
    float headRadius) {
  proc_deform_snake_from_poses(
      g_proc.poseIn, headX, headY, headZ, heading, headPitch,
      poseCount, rings, radial, elapsed,
      headWidth, headHeight, bodyWidth, bodyHeight, hoodStrength, segSpacing, headRadius, 0.0f);
}

void wasm_deform_player_body(
    float headY,
    float headPitch,
    int32_t rings,
    int32_t radial,
    float elapsed,
    float headWidth,
    float headHeight,
    float bodyWidth,
    float bodyHeight,
    float hoodStrength) {
  float sc = c_clampf(g_sim.scalars.snakeScale, START_SNAKE_SCALE, MAX_SNAKE_SCALE);
  proc_deform_snake_from_poses(
      g_sim.playerPoses,
      g_sim.scalars.headX,
      headY,
      g_sim.scalars.headZ,
      g_sim.scalars.heading,
      headPitch,
      g_sim.scalars.segmentCount,
      rings,
      radial,
      elapsed,
      headWidth,
      headHeight,
      bodyWidth,
      bodyHeight,
      hoodStrength,
      SEGMENT_SPACING * sc,
      HEAD_RADIUS * sc,
      g_sim.scalars.swallowBulgeT);
}

void wasm_deform_hatchling_body(
    int32_t hIdx,
    float headY,
    int32_t rings,
    int32_t radial,
    float elapsed,
    float headWidth,
    float headHeight,
    float bodyWidth,
    float bodyHeight,
    float hoodStrength,
    float segSpacing) {
  if (hIdx < 0 || hIdx >= g_sim.hatchlingCount) return;
  const HatchlingSlot& h = g_sim.hatchlings[hIdx];
  proc_deform_snake_from_poses(
      g_sim.hatchlingPoses[hIdx],
      h.x,
      headY,
      h.z,
      h.heading,
      0.0f,
      h.poseCount,
      rings,
      radial,
      elapsed,
      headWidth,
      headHeight,
      bodyWidth,
      bodyHeight,
      hoodStrength,
      segSpacing,
      HEAD_RADIUS,
      0.0f);
}

void wasm_write_snake_shadow_mats(int32_t segCount) {
  proc_write_snake_shadow_mats(segCount);
}

void wasm_spawn_particle_burst(float x, float y, float z, uint32_t hexColor, int32_t count, float speedScale) {
  proc_spawn_particle_burst(x, y, z, hexColor, count, speedScale);
}

int32_t wasm_step_particles(float dt) {
  return proc_step_particles(dt);
}

void wasm_snap_camera(int32_t phase, float baseFov) {
  proc_snap_camera(phase, baseFov);
}

void wasm_step_camera(float dt, float elapsed, float baseFov, float traumaAdd) {
  proc_step_camera(dt, elapsed, baseFov, traumaAdd);
}

void wasm_fill_terrain_heights(int32_t segs, float worldSize) {
  proc_fill_terrain_heights(segs, worldSize);
}

void wasm_sobel_height_to_normal(int32_t w, int32_t h, float strength) {
  proc_sobel_height_to_normal(w, h, strength);
}

} // extern "C"
