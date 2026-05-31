"use strict";

const assert = require("node:assert/strict");
const { extractFarmhands } = require("./save-repair");

async function main() {
  const topLevelFarmhands = `
    <SaveGame>
      <farmhands>
        <Farmer>
          <name>Alice</name>
          <UniqueMultiplayerID>101</UniqueMultiplayerID>
          <isCustomized>true</isCustomized>
        </Farmer>
        <Farmer>
          <name>Bob</name>
          <UniqueMultiplayerID>202</UniqueMultiplayerID>
          <isCustomized>false</isCustomized>
        </Farmer>
      </farmhands>
    </SaveGame>`;
  assert.deepEqual(extractFarmhands(topLevelFarmhands), [
    { id: "101", name: "Alice", isCustomized: true },
    { id: "202", name: "Bob", isCustomized: false },
  ]);

  const cabinFallback = `
    <SaveGame>
      <farmhands />
      <buildings>
        <Building>
          <buildingType>Cabin</buildingType>
          <farmhandReference>303</farmhandReference>
          <indoors xsi:type="Cabin">
            <farmhand>
              <Farmer>
                <name>Carol</name>
                <UniqueMultiplayerID>303</UniqueMultiplayerID>
                <isCustomized>true</isCustomized>
              </Farmer>
            </farmhand>
          </indoors>
        </Building>
      </buildings>
    </SaveGame>`;
  assert.deepEqual(extractFarmhands(cabinFallback), [
    { id: "303", name: "Carol", isCustomized: true },
  ]);

  const referenceOnlyCabin = `
    <SaveGame>
      <buildings>
        <Building>
          <buildingType>Log Cabin</buildingType>
          <farmhandReference>404</farmhandReference>
        </Building>
      </buildings>
    </SaveGame>`;
  assert.deepEqual(extractFarmhands(referenceOnlyCabin), [
    { id: "404", name: "", isCustomized: false },
  ]);

  console.log("save-repair.self-test ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
