/** Helka ceramics (Berlin, Kreuzberg): the shop's data. Served by the dev API (server/api.ts) and reused for SDK fixtures. */

export type Shape = 'mug' | 'cup' | 'bowl' | 'wide-bowl' | 'plate' | 'egg-cup' | 'candle' | 'tray';
export type Category = 'cups' | 'bowls' | 'plates' | 'interior';

export interface Product {
  id: string;
  name: string;
  /** Glaze name, shown muted after an em dash: "Tall mug — periwinkle". */
  glaze: string;
  price: number;
  category: Category;
  shape: Shape;
  /** Glaze colour of the piece. */
  color: string;
  /** Backdrop of the product photo. */
  backdrop: string;
  stock: number;
  size: string;
  blurb: string;
  /** Styling detail in the product photo. */
  garnish?: 'egg' | 'pour';
}

export interface CatalogResponse {
  items: Product[];
  /** Pieces whose details failed to load (partial response). */
  unavailable?: number;
}

export interface Interest {
  id: string;
  label: string;
}

export interface BagLine {
  productId: string;
  qty: number;
  /** Set when the piece sold out after it was added. */
  soldOut?: boolean;
}

export interface BagResponse {
  lines: Array<BagLine & { product: Product }>;
}

export interface Address {
  name: string;
  street: string;
  city: string;
}

export interface Order {
  id: string;
  eta: string;
  total: number;
  items: Array<Pick<Product, 'id' | 'name' | 'glaze' | 'shape' | 'color' | 'backdrop'>>;
  /** A piece still in the kiln that ships separately. */
  later?: { name: string; date: string };
}

export interface PotteryClass {
  id: string;
  title: string;
  kind: string;
  weeks: string;
  price: number;
  next: string;
  sessions: string[];
  seatsLeft: number;
  teacher: string;
  blurb: string;
  tone: 'clay' | 'wheel' | 'glaze';
}

export interface Booking {
  ref: string;
  classTitle: string;
  date: string;
  seats: number;
}

const p = (x: Product) => x;

export const PRODUCTS: Product[] = [
  p({ id: 'tall-mug-periwinkle', name: 'Tall mug', glaze: 'periwinkle', price: 45, category: 'cups', shape: 'mug', color: '#8C9BC8', backdrop: '#DEE1E8', stock: 8, size: '380 ml', blurb: 'A tall, straight-sided mug thrown on the wheel and dipped in our soft periwinkle glaze. The handle fits three fingers; the clay stays warm long after the coffee is gone.' }),
  p({ id: 'cappuccino-cup-butter', name: 'Cappuccino cup', glaze: 'butter yellow', price: 27, category: 'cups', shape: 'cup', color: '#EBD9A0', backdrop: '#E4E0EE', stock: 1, size: '180 ml', garnish: 'pour', blurb: 'Wide enough for a proper foam top, small enough to hold in one hand. Butter-yellow glaze over speckled stoneware.' }),
  p({ id: 'serving-bowl-apricot', name: 'Serving bowl', glaze: 'apricot', price: 58, category: 'bowls', shape: 'wide-bowl', color: '#E59E4E', backdrop: '#E3E1DD', stock: 5, size: '24 cm', blurb: 'A shallow bowl for salads and long dinners. The apricot glaze pools darker in the well and breaks to bare clay at the rim.' }),
  p({ id: 'side-plate-chantilly', name: 'Side plate', glaze: 'chantilly', price: 24, category: 'plates', shape: 'plate', color: '#F1EADB', backdrop: '#E6E4E0', stock: 14, size: '19 cm', garnish: 'egg', blurb: 'A side plate for toast, cake or a soft-boiled egg. Chantilly is our warm, satin white.' }),
  p({ id: 'big-bowl-periwinkle', name: 'Big bowl', glaze: 'periwinkle', price: 46, category: 'bowls', shape: 'bowl', color: '#8C9BC8', backdrop: '#E2E2E4', stock: 6, size: '18 cm', blurb: 'Deep enough for ramen or a big breakfast. Periwinkle outside, a paler wash inside.' }),
  p({ id: 'canele-dinner-plate', name: 'Canelé dinner plate', glaze: 'chantilly', price: 36, category: 'plates', shape: 'plate', color: '#EFE7D6', backdrop: '#DCDDE2', stock: 9, size: '27 cm', blurb: 'Our dinner plate with a fluted rim, pressed from a mould we carved after the little Bordeaux cakes. Satin chantilly glaze, dishwasher safe.' }),
  p({ id: 'canele-egg-cup', name: 'Canelé egg cup', glaze: 'chantilly', price: 28, category: 'cups', shape: 'egg-cup', color: '#EEE6D4', backdrop: '#E5E1DA', stock: 11, size: '6 cm', blurb: 'A fluted egg cup for slow Sunday breakfasts. Sold singly; they look best in pairs.' }),
  p({ id: 'espresso-cup-moss', name: 'Espresso cup', glaze: 'moss', price: 22, category: 'cups', shape: 'cup', color: '#8B9670', backdrop: '#E2E3DC', stock: 16, size: '90 ml', blurb: 'Small, weighty and glazed in a deep moss green that turns amber at the edges.' }),
  p({ id: 'candleholder-sand', name: 'Candleholder', glaze: 'sand', price: 32, category: 'interior', shape: 'candle', color: '#D8C3A0', backdrop: '#E8E2D8', stock: 2, size: '9 cm', blurb: 'A low holder for dinner candles with a wide drip tray. Unglazed sand stoneware, waxed by hand.' }),
  p({ id: 'serving-tray-oat', name: 'Serving tray', glaze: 'oat', price: 64, category: 'interior', shape: 'tray', color: '#D9CDB4', backdrop: '#E4E2DE', stock: 4, size: '36 cm', blurb: 'An oval tray for bread, cheese or a row of cups. Oat glaze with iron speckles.' }),
  p({ id: 'pasta-bowl-chantilly', name: 'Pasta bowl', glaze: 'chantilly', price: 38, category: 'bowls', shape: 'wide-bowl', color: '#F0E8D8', backdrop: '#DFE0E4', stock: 10, size: '22 cm', blurb: 'Wide and shallow, so the sauce stays where it should. Satin chantilly glaze.' }),
  p({ id: 'dinner-plate-periwinkle', name: 'Dinner plate', glaze: 'periwinkle', price: 34, category: 'plates', shape: 'plate', color: '#9AA6CE', backdrop: '#E4E3E6', stock: 0, size: '27 cm', blurb: 'The everyday plate in periwinkle. Back in the next firing.' }),
];

export const INTERESTS: Interest[] = [
  { id: 'cups', label: 'Cups & mugs' },
  { id: 'bowls', label: 'Bowls' },
  { id: 'plates', label: 'Plates' },
  { id: 'egg-cups', label: 'Egg cups' },
  { id: 'candleholders', label: 'Candleholders' },
  { id: 'trays', label: 'Serving trays' },
  { id: 'classes', label: 'Pottery classes' },
  { id: 'gift-cards', label: 'Gift cards' },
];

export const CLASSES: PotteryClass[] = [
  { id: 'tableware-course', title: '4-week tableware course', kind: 'Course', weeks: '4 Wednesdays · 18:30–21:00', price: 290, next: 'Wed, Nov 26', sessions: ['Wed, Nov 26', 'Wed, Dec 3', 'Wed, Dec 10', 'Wed, Dec 17'], seatsLeft: 3, teacher: 'Jana Weber', tone: 'wheel', blurb: 'Throw a set of four plates and four bowls over four evenings: centring, trimming, glazing. We fire everything and you pick it up in January.' },
  { id: 'evening-workshop', title: 'Evening pottery workshop', kind: 'Workshop', weeks: 'One evening · 19:00–21:30', price: 85, next: 'Fri, Nov 21', sessions: ['Fri, Nov 21'], seatsLeft: 5, teacher: 'Mehmet Aydın', tone: 'clay', blurb: 'A first go at the wheel with wine and bread. You make two pieces; we glaze and fire them for you.' },
  { id: 'glaze-lab', title: 'Glaze lab', kind: 'Workshop', weeks: 'Saturday · 11:00–15:00', price: 120, next: 'Sat, Nov 29', sessions: ['Sat, Nov 29'], seatsLeft: 2, teacher: 'Jana Weber', tone: 'glaze', blurb: 'Mix three glazes from raw materials and test them on tiles. For people who already throw.' },
];

export const START_BAG: BagLine[] = [
  { productId: 'tall-mug-periwinkle', qty: 1 },
  { productId: 'canele-dinner-plate', qty: 1 },
  { productId: 'cappuccino-cup-butter', qty: 1 },
];

export const WISHLIST_IDS = ['big-bowl-periwinkle', 'canele-egg-cup', 'candleholder-sand'];

export const ADDRESS: Address = { name: 'Maya Lindqvist', street: 'Oranienstraße 18', city: '10999 Berlin' };

/** Delivery is free from €80. */
export const SHIPPING = 6;
export const deliveryFor = (subtotal: number) => (subtotal >= 80 ? 0 : SHIPPING);

export function productById(id: string): Product | undefined {
  return PRODUCTS.find((x) => x.id === id);
}

export function bagResponse(lines: BagLine[]): BagResponse {
  return { lines: lines.flatMap((l) => (productById(l.productId) ? [{ ...l, product: productById(l.productId)! }] : [])) };
}

export function bagSubtotal(b: BagResponse): number {
  return b.lines.filter((l) => !l.soldOut).reduce((n, l) => n + l.product.price * l.qty, 0);
}

export function bagTotal(b: BagResponse): number {
  const s = bagSubtotal(b);
  return s + deliveryFor(s);
}

export function latestOrder(): Order {
  const bag = bagResponse(START_BAG);
  return {
    id: 'HK-20418',
    eta: 'Thu, Nov 20',
    total: bagTotal(bag),
    items: bag.lines.map(({ product: { id, name, glaze, shape, color, backdrop } }) => ({ id, name, glaze, shape, color, backdrop })),
  };
}

export function classById(id: string): PotteryClass | undefined {
  return CLASSES.find((c) => c.id === id);
}

export const euro = (n: number) => `€${n.toFixed(2)}`;
