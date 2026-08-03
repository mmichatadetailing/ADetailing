import type { Service, ServicePrice, ServicePricingMode } from "@/lib/domain/types";

export const servicePricingModeLabels: Record<ServicePricingMode, string> = {
  vehicle_format: "Selon le type de véhicule",
  vehicle_count: "Selon le nombre de véhicules",
  custom: "Autre logique",
};

export function getServicePricingMode(service: Pick<Service, "pricingMode">): ServicePricingMode {
  return service.pricingMode ?? "vehicle_format";
}

export function vehicleCountTierLabel(minimum: number, maximum?: number) {
  if (maximum === undefined) return `${minimum} véhicule${minimum > 1 ? "s" : ""} et +`;
  if (minimum === maximum) return `${minimum} véhicule${minimum > 1 ? "s" : ""}`;
  return `${minimum} à ${maximum} véhicules`;
}

export function servicePriceRuleLabel(price: ServicePrice, mode: ServicePricingMode) {
  if (mode === "vehicle_count" && price.minimumVehicleCount !== undefined) {
    return vehicleCountTierLabel(price.minimumVehicleCount, price.maximumVehicleCount);
  }
  return price.label || price.vehicleFormat || "Tarif standard";
}

export function resolveServicePrice(
  service: Service | undefined,
  context: { vehicleFormat?: string; vehicleCount?: number; priceLabel?: string },
) {
  if (!service) return undefined;
  const mode = getServicePricingMode(service);
  if (mode === "vehicle_count") {
    const count = Math.max(1, Math.floor(context.vehicleCount ?? 1));
    return service.prices.find((price) =>
      price.minimumVehicleCount !== undefined
      && count >= price.minimumVehicleCount
      && (price.maximumVehicleCount === undefined || count <= price.maximumVehicleCount),
    );
  }
  if (mode === "vehicle_format") {
    return service.prices.find((price) => price.vehicleFormat === context.vehicleFormat)
      ?? service.prices.find((price) => price.vehicleFormat === "Tous formats")
      ?? service.prices[0];
  }
  return service.prices.find((price) => servicePriceRuleLabel(price, mode) === context.priceLabel) ?? service.prices[0];
}

export function suggestedServicePrice(
  service: Service | undefined,
  context: { vehicleFormat?: string; vehicleCount?: number; priceLabel?: string },
) {
  const price = resolveServicePrice(service, context);
  if (!price) return undefined;
  const multiplier = getServicePricingMode(service!) === "vehicle_count" ? Math.max(1, Math.floor(context.vehicleCount ?? 1)) : 1;
  return {
    rule: price,
    minimumAmount: price.amount * multiplier,
    maximumAmount: (price.maximumAmount ?? price.amount) * multiplier,
    unitAmount: price.amount,
    unitMaximumAmount: price.maximumAmount ?? price.amount,
    multiplier,
  };
}
