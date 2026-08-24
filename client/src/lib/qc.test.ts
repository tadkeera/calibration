import { afterEach, describe, expect, it } from "vitest";
import { applyDeviceProfileOverrides, findDevice } from "./qc";

const originalDisintegration = { ...findDevice("disintegration") };

afterEach(() => {
  applyDeviceProfileOverrides([{
    instrumentKey: "disintegration",
    nameAr: originalDisintegration.name,
    nameEn: originalDisintegration.english,
    instrumentId: originalDisintegration.id,
    sopNumber: originalDisintegration.sop,
    manufacturer: originalDisintegration.manufacturer,
    model: originalDisintegration.model,
    serialNumber: originalDisintegration.serial,
    formNumber: originalDisintegration.form,
    accent: originalDisintegration.accent,
  }]);
});

describe("applyDeviceProfileOverrides", () => {
  it("updates controlled device metadata used by future forms and reports", () => {
    applyDeviceProfileOverrides([{
      instrumentKey: "disintegration",
      nameAr: "اسم الجهاز المحدّث",
      nameEn: "Updated Disintegration Tester",
      instrumentId: "QC-I-NEW",
      sopNumber: "QC-NEW",
      manufacturer: "Reference Manufacturer",
      model: "Reference Model",
      serialNumber: "REF-123",
      formNumber: "QC-REF-01",
      accent: "#123456",
    }]);

    expect(findDevice("disintegration")).toMatchObject({
      name: "اسم الجهاز المحدّث",
      english: "Updated Disintegration Tester",
      id: "QC-I-NEW",
      sop: "QC-NEW",
      form: "QC-REF-01",
      accent: "#123456",
    });
  });
});
