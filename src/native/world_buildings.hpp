#pragma once
#include <stdint.h>
#include "math_core.hpp"

namespace serpentis {

enum BuildingKind : int32_t {
  BLDG_CABIN = 0,
  BLDG_MANOR = 1,
  BLDG_RUIN_TOWER = 2,
};

struct FloorZone {
  float minX, maxX, minZ, maxZ;
  float elevation;
  uint8_t isInterior;
  uint8_t isRoof;
  const char* label;
};

struct RampZone {
  float minX, maxX, minZ, maxZ;
  uint8_t axis; // 0 = 'x', 1 = 'z'
  float startCoord, endCoord;
  float startY, endY;
  uint8_t isInterior;
  const char* label;
};

struct WallBox {
  float minX, maxX, minZ, maxZ, minY, maxY;
};

struct EnterableBuilding {
  int32_t id;
  BuildingKind kind;
  const char* name;
  float x;
  float z;
  float rotation;
  float scale;
  float footprintRadius;
  int32_t floorCount;
  FloorZone floors[6];
  int32_t rampCount;
  RampZone ramps[4];
  int32_t wallCount;
  WallBox walls[10];
  float interiorSpotX, interiorSpotZ, interiorSpotY;
  float upperSpotX, upperSpotZ, upperSpotY;
};

struct CollisionResult {
  float x;
  float z;
  int32_t collided;
  float normalX;
  float normalZ;
};

struct BuildingLocResult {
  int32_t buildingIdx; // -1 if none
  int32_t buildingId;  // -1 if none
  int32_t zoneType;    // 0=none, 1=ramp, 2=floor, 3=village, 4=outskirts, 5=north_woods, 6=emerald_forest
  int32_t zoneIdx;     // index into ramps[] or floors[], or villageIdx when zoneType==3
  uint8_t isIndoors;
  uint8_t hideRoof;
};

extern const VillageDef g_villages[NUM_VILLAGES];
extern EnterableBuilding g_buildings[24];
extern int32_t g_building_count;
extern WallBox g_fence_walls[72];
extern int32_t g_fence_count;

int32_t find_village_at(float x, float z, float margin = 0.0f);
bool is_inside_village(float x, float z, float margin = 0.0f);
float ground_height_at(float x, float z);
void world_to_building_local(const EnterableBuilding& b, float wx, float wz, float& outLx, float& outLz);
void building_local_to_world(const EnterableBuilding& b, float lx, float lz, float& outWx, float& outWz);
void init_world_buildings_and_fences();
float surface_height_at(float x, float z, float currentY);
BuildingLocResult get_building_at_position(float x, float z, float y);
CollisionResult resolve_building_wall_collision(float x, float y, float z, float radius);
CollisionResult resolve_world_walls_collision(float x, float y, float z, float radius);
bool is_point_near_building(float x, float z, float padding);

} // namespace serpentis
