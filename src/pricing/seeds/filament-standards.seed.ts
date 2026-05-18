/**
 * Filament Standards Seed Data - Tunisian Market (TND)
 * Run this to populate the filament_standards table with default values
 */

export const FILAMENT_STANDARDS_SEED = [
  {
    type: 'PLA' as const,
    name: 'Polylactic Acid (PLA)',
    density: '1.24',
    defaultNozzleTemp: 200,
    defaultBedTemp: 60,
    defaultPrintSpeed: 60,
    color: '#F5DEB3',
    description:
      'Biodegradable, easy to print, low warping. Good for prototypes and decorative items.',
  },
  {
    type: 'PETG' as const,
    name: 'Polyethylene Terephthalate Glycol (PETG)',
    density: '1.27',
    defaultNozzleTemp: 230,
    defaultBedTemp: 80,
    defaultPrintSpeed: 50,
    color: '#87CEEB',
    description:
      'Strong, durable, chemical resistant. Good mechanical properties with easier printing than ABS.',
  },
  {
    type: 'ABS' as const,
    name: 'Acrylonitrile Butadiene Styrene (ABS)',
    density: '1.04',
    defaultNozzleTemp: 240,
    defaultBedTemp: 100,
    defaultPrintSpeed: 50,
    color: '#4A4A4A',
    description:
      'High strength, heat resistant, can be acetone smoothed. Requires heated bed and enclosure.',
  },
  {
    type: 'TPU' as const,
    name: 'Thermoplastic Polyurethane (TPU)',
    density: '1.21',
    defaultNozzleTemp: 220,
    defaultBedTemp: 60,
    defaultPrintSpeed: 30,
    color: '#FF6B6B',
    description:
      'Flexible, rubber-like material. Good for phone cases, gaskets, and wearables.',
  },
  {
    type: 'ASA' as const,
    name: 'Acrylonitrile Styrene Acrylate (ASA)',
    density: '1.07',
    defaultNozzleTemp: 240,
    defaultBedTemp: 100,
    defaultPrintSpeed: 50,
    color: '#FFD700',
    description:
      'UV resistant alternative to ABS. Good for outdoor applications.',
  },
  {
    type: 'PC' as const,
    name: 'Polycarbonate (PC)',
    density: '1.20',
    defaultNozzleTemp: 260,
    defaultBedTemp: 110,
    defaultPrintSpeed: 40,
    color: '#E0E0E0',
    description:
      'Very strong, heat resistant, transparent options available. Requires high temperatures.',
  },
  {
    type: 'NYLON' as const,
    name: 'Nylon (PA)',
    density: '1.14',
    defaultNozzleTemp: 250,
    defaultBedTemp: 80,
    defaultPrintSpeed: 45,
    color: '#F5F5DC',
    description:
      'Extremely tough, self-lubricating, absorbs moisture. Keep filament dry.',
  },
  {
    type: 'HIPS' as const,
    name: 'High Impact Polystyrene (HIPS)',
    density: '1.05',
    defaultNozzleTemp: 230,
    defaultBedTemp: 100,
    defaultPrintSpeed: 50,
    color: '#FFFACD',
    description:
      'Often used as soluble support material for ABS. Dissolves in limonene.',
  },
  {
    type: 'WOOD' as const,
    name: 'Wood-filled Filament',
    density: '1.30',
    defaultNozzleTemp: 200,
    defaultBedTemp: 60,
    defaultPrintSpeed: 40,
    color: '#DEB887',
    description:
      'Contains wood particles, can be sanded and stained. Use larger nozzle (0.5mm+).',
  },
  {
    type: 'METAL_FILLED' as const,
    name: 'Metal-filled Filament',
    density: '2.50',
    defaultNozzleTemp: 210,
    defaultBedTemp: 60,
    defaultPrintSpeed: 30,
    color: '#C0C0C0',
    description:
      'Contains metal powder (bronze, copper, etc.). Heavy, can be polished.',
  },
  {
    type: 'CARBON_FIBER' as const,
    name: 'Carbon Fiber Reinforced',
    density: '1.35',
    defaultNozzleTemp: 240,
    defaultBedTemp: 80,
    defaultPrintSpeed: 40,
    color: '#2F2F2F',
    description:
      'Extremely stiff and strong. Abrasive - requires hardened steel nozzle.',
  },
  {
    type: 'OTHER' as const,
    name: 'Other / Specialty',
    density: '1.25',
    defaultNozzleTemp: 210,
    defaultBedTemp: 60,
    defaultPrintSpeed: 50,
    color: '#808080',
    description: 'Specialty filaments not listed above.',
  },
];

// Default market prices per gram (TND - Tunisian Dinar) for Tunisian market
// Based on local market prices in Tunisia
export const DEFAULT_FILAMENT_PRICES: Record<string, number> = {
  PLA: 0.08,       // ~80 TND/kg (local/imported mix)
  PETG: 0.10,      // ~100 TND/kg
  ABS: 0.09,       // ~90 TND/kg
  TPU: 0.18,       // ~180 TND/kg (specialty)
  ASA: 0.12,       // ~120 TND/kg
  PC: 0.20,        // ~200 TND/kg (high temp)
  NYLON: 0.25,     // ~250 TND/kg (specialty)
  HIPS: 0.08,      // ~80 TND/kg
  WOOD: 0.15,      // ~150 TND/kg (specialty)
  METAL_FILLED: 0.50,    // ~500 TND/kg (premium)
  CARBON_FIBER: 0.35,    // ~350 TND/kg (premium)
  OTHER: 0.10,     // ~100 TND/kg default
};

// Currency code for Tunisian Dinar
export const DEFAULT_CURRENCY = 'TND';
