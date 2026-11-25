import { q } from "./db.js";

/**
 * Realistic demo data for a building-materials shop:
 * products, customers with dues, suppliers, two weeks of sales, and expenses.
 */
export async function seedDemo(shopId, client) {
  const products = [
    // name, category, unit, qty, price, cost, reorder
    ["Cement bags (UltraTech 50kg)", "Cement", "bag", 70, 420, 335, 40],
    ["TMT steel rods 12mm", "Steel", "rod", 240, 680, 545, 100],
    ["PVC pipes 4 inch", "Plumbing", "piece", 85, 540, 395, 30],
    ["River sand", "Aggregates", "tonne", 12, 1800, 1250, 10],
    ["Red bricks", "Masonry", "1000 pcs", 9, 7200, 5400, 5],
    ["Wall putty 40kg", "Paint", "bag", 34, 780, 540, 15],
    ["Asian Paints Apex 20L", "Paint", "bucket", 6, 4950, 3850, 8],
    ["Binding wire", "Steel", "kg", 140, 85, 58, 50],
  ];

  const productIds = {};
  for (const [name, category, unit, qty, price, cost, reorder] of products) {
    const [row] = await q(
      `INSERT INTO products (shop_id, name, category, unit, qty, price, cost, reorder_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [shopId, name, category, unit, qty, price, cost, reorder],
      client
    );
    productIds[name] = { id: row.id, price, cost };
  }

  const customers = [
    ["Sharma Traders", "+91 98220 11234", 18500, 25000, 48],
    ["Patil Constructions", "+91 98900 45678", 12000, 15000, 21],
    ["Kale Hardware", "+91 97654 32109", 4200, 10000, 9],
    ["Deshmukh Builders", "+91 99220 87654", 31500, 30000, 75],
    ["Joshi Interiors", "+91 98500 23456", 0, 8000, 0],
  ];

  const customerIds = {};
  for (const [name, phone, opening, limit, daysAgo] of customers) {
    const [row] = await q(
      `INSERT INTO customers (shop_id, name, phone, credit_limit) VALUES ($1, $2, $3, $4) RETURNING id`,
      [shopId, name, phone, limit],
      client
    );
    customerIds[name] = row.id;
    if (opening > 0) {
      await q(
        `INSERT INTO ledger (shop_id, customer_id, amount, note, kind, created_at)
         VALUES ($1, $2, $3, 'Opening balance', 'opening', now() - make_interval(days => $4))`,
        [shopId, row.id, opening, daysAgo],
        client
      );
    }
  }
  // A partial payment so statements show both directions.
  await q(
    `INSERT INTO ledger (shop_id, customer_id, amount, note, kind, created_at)
     VALUES ($1, $2, -3000, 'Payment received (upi)', 'payment', now() - interval '6 days')`,
    [shopId, customerIds["Sharma Traders"]],
    client
  );

  const suppliers = [
    ["UltraTech Distributors Pune", "+91 20 2765 4321"],
    ["Mahalaxmi Steel Depot", "+91 98222 33445"],
  ];
  const supplierIds = {};
  for (const [name, phone] of suppliers) {
    const [row] = await q(
      `INSERT INTO suppliers (shop_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
      [shopId, name, phone],
      client
    );
    supplierIds[name] = row.id;
  }

  const purchases = [
    ["Cement bags (UltraTech 50kg)", "UltraTech Distributors Pune", 100, 335, 12],
    ["TMT steel rods 12mm", "Mahalaxmi Steel Depot", 200, 545, 9],
    ["Binding wire", "Mahalaxmi Steel Depot", 100, 58, 9],
  ];
  for (const [product, supplier, qty, unitCost, daysAgo] of purchases) {
    await q(
      `INSERT INTO purchases (shop_id, supplier_id, product_id, product_name, qty, unit_cost, total, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() - make_interval(days => $8))`,
      [shopId, supplierIds[supplier], productIds[product].id, product, qty, unitCost, qty * unitCost, daysAgo],
      client
    );
  }

  // Deterministic pseudo-random sales over the last 14 days.
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const names = Object.keys(productIds);
  const methods = ["cash", "cash", "upi", "upi", "upi", "card", "credit"];
  const creditors = ["Patil Constructions", "Kale Hardware", "Joshi Interiors"];

  for (let day = 13; day >= 0; day--) {
    const bills = 2 + Math.floor(rand() * 4);
    for (let b = 0; b < bills; b++) {
      const method = methods[Math.floor(rand() * methods.length)];
      const lineCount = 1 + Math.floor(rand() * 2);
      const lines = [];
      for (let l = 0; l < lineCount; l++) {
        const name = names[Math.floor(rand() * names.length)];
        if (lines.some((x) => x.name === name)) continue;
        const unitQty = name.includes("bricks") || name.includes("sand") || name.includes("Apex") ? 1 : 2 + Math.floor(rand() * 10);
        lines.push({ name, qty: unitQty, ...productIds[name] });
      }
      const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
      const customer = method === "credit" ? creditors[Math.floor(rand() * creditors.length)] : null;
      const hours = day * 24 + Math.floor(rand() * 9) + 1;

      const [sale] = await q(
        `INSERT INTO sales (shop_id, customer_id, payment_method, total, created_at)
         VALUES ($1, $2, $3, $4, now() - make_interval(hours => $5)) RETURNING id`,
        [shopId, customer ? customerIds[customer] : null, method, total, hours],
        client
      );
      for (const l of lines) {
        await q(
          `INSERT INTO sale_items (sale_id, product_id, product_name, qty, unit_price, unit_cost)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sale.id, l.id, l.name, l.qty, l.price, l.cost],
          client
        );
      }
      if (customer) {
        await q(
          `INSERT INTO ledger (shop_id, customer_id, amount, note, kind, sale_id, created_at)
           VALUES ($1, $2, $3, $4, 'sale', $5, now() - make_interval(hours => $6))`,
          [shopId, customerIds[customer], total, `Bill ${sale.id.slice(0, 8)}`, sale.id, hours],
          client
        );
      }
    }
  }

  const expenses = [
    ["rent", 25000, "Shop rent", 20],
    ["salary", 18000, "Helper salary", 18],
    ["electricity", 3400, "MSEB bill", 10],
    ["transport", 2200, "Tempo for deliveries", 4],
    ["transport", 1500, "Loading charges", 1],
  ];
  for (const [category, amount, noteText, daysAgo] of expenses) {
    await q(
      `INSERT INTO expenses (shop_id, category, amount, note, spent_on)
       VALUES ($1, $2, $3, $4, CURRENT_DATE - $5::int)`,
      [shopId, category, amount, noteText, daysAgo],
      client
    );
  }
}
