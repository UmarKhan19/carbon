export type ProductLabelItem = {
  itemId: string;
  revision?: string;
  quantity?: number;
  number: string;
  trackedEntityId: string;
  trackingType: string;
};

export type LabelSize = {
  id: string;
  name: string;
  width: number;
  height: number;
  description: string;
  metric?: boolean;
  rows?: number;
  columns?: number;
  rotated?: boolean;
  zpl?: {
    dpi: number;
    width: number;
    height: number;
  };
};

export const labelSizes: LabelSize[] = [
  {
    id: "avery5160",
    name: "Avery 5160",
    width: 2.625, // inches to points (72 points per inch)
    height: 1,
    description: 'Address Labels (1" x 2.625")',
    rows: 10,
    columns: 3,
    rotated: false
  },
  {
    id: "avery5163",
    name: "Avery 5163",
    width: 4,
    height: 2,
    description: 'Shipping Labels (2" x 4")',
    rows: 5,
    columns: 2,
    rotated: false
  },
  {
    id: "label2x1",
    name: "Label 2x1",
    width: 2,
    height: 1,
    description: 'Thermal Labels (1" x 2")',
    rotated: false,
    zpl: {
      dpi: 203,
      width: 2,
      height: 1
    }
  },
  {
    id: "label4x2",
    name: "Label 4x2",
    width: 4,
    height: 2,
    description: 'Thermal Labels (2" x 4")',
    rotated: false,
    zpl: {
      dpi: 203,
      width: 4,
      height: 2
    }
  },
  {
    id: "label100x50mm",
    name: "Label 100x50mm",
    width: 3.937,
    height: 1.969,
    description: "Thermal Labels (50mm x 100mm)",
    metric: true,
    rotated: false,
    zpl: {
      dpi: 203,
      width: 3.937,
      height: 1.969
    }
  },
  {
    id: "label50x25mm",
    name: "Label 50x25mm",
    width: 1.969,
    height: 0.984,
    description: "Thermal Labels (25mm x 50mm)",
    metric: true,
    rotated: false,
    zpl: {
      dpi: 203,
      width: 1.969,
      height: 0.984
    }
  }
];
