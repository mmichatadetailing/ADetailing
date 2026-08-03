import { describe, expect, it } from "vitest";
import { resolveServicePrice, suggestedServicePrice, vehicleCountTierLabel } from "@/lib/domain/service-pricing";
import type { Service } from "@/lib/domain/types";

const subscription = {
  pricingMode: "vehicle_count",
  prices: [
    { label: "1 à 3 véhicules", minimumVehicleCount: 1, maximumVehicleCount: 3, amount: 11_000, maximumAmount: 11_000 },
    { label: "4 à 6 véhicules", minimumVehicleCount: 4, maximumVehicleCount: 6, amount: 9_900, maximumAmount: 9_900 },
    { label: "7 véhicules et +", minimumVehicleCount: 7, amount: 8_900, maximumAmount: 8_900 },
  ],
} as Service;

describe("tarification des abonnements", () => {
  it("sélectionne le bon palier selon le nombre de véhicules", () => {
    expect(resolveServicePrice(subscription, { vehicleCount: 2 })?.amount).toBe(11_000);
    expect(resolveServicePrice(subscription, { vehicleCount: 5 })?.amount).toBe(9_900);
    expect(resolveServicePrice(subscription, { vehicleCount: 12 })?.amount).toBe(8_900);
  });

  it("calcule le montant total à partir du tarif unitaire", () => {
    expect(suggestedServicePrice(subscription, { vehicleCount: 5 })).toMatchObject({
      unitAmount: 9_900,
      minimumAmount: 49_500,
      maximumAmount: 49_500,
      multiplier: 5,
    });
  });

  it("formate les paliers bornés et ouverts", () => {
    expect(vehicleCountTierLabel(1, 3)).toBe("1 à 3 véhicules");
    expect(vehicleCountTierLabel(7)).toBe("7 véhicules et +");
  });

  it("sélectionne explicitement une règle personnalisée", () => {
    const custom = { pricingMode: "custom", prices: [{ label: "Partenaire", amount: 8_000 }, { label: "Premium", amount: 12_000 }] } as Service;
    expect(resolveServicePrice(custom, { priceLabel: "Premium" })?.amount).toBe(12_000);
  });

  it("accepte des paliers libres, non contigus et ne commençant pas à 1", () => {
    const freeTiers = {
      pricingMode: "vehicle_count",
      prices: [
        { label: "5 à 8", minimumVehicleCount: 5, maximumVehicleCount: 8, amount: 10_000 },
        { label: "20 à 30", minimumVehicleCount: 20, maximumVehicleCount: 30, amount: 8_000 },
      ],
    } as Service;
    expect(resolveServicePrice(freeTiers, { vehicleCount: 6 })?.amount).toBe(10_000);
    expect(resolveServicePrice(freeTiers, { vehicleCount: 15 })).toBeUndefined();
    expect(resolveServicePrice(freeTiers, { vehicleCount: 24 })?.amount).toBe(8_000);
  });
});
