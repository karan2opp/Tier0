import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { customers, devices } from "../../db/schema";

/** Last 10 digits of a phone number, so "+91 90000 00001" and "9000000001" match. */
export const phoneKey = (phone: string) => phone.replace(/\D/g, "").slice(-10);

export async function findCustomerByEmail(email: string) {
  return db.query.customers.findFirst({ where: eq(customers.email, email.trim().toLowerCase()) });
}

export async function findCustomerByPhone(phone: string) {
  const key = phoneKey(phone);
  if (key.length < 10) return undefined;
  return db.query.customers.findFirst({
    where: sql`right(regexp_replace(${customers.phone}, '[^0-9]', '', 'g'), 10) = ${key}`,
  });
}

export async function findSerialNumbers(customerId: string): Promise<string[]> {
  const rows = await db.select({ serial: devices.serialNumber }).from(devices).where(eq(devices.customerId, customerId));
  return rows.map((row) => row.serial);
}

export async function findDevicesWithWarranties(customerId: string) {
  return db.query.devices.findMany({
    where: eq(devices.customerId, customerId),
    with: { warranties: true },
    orderBy: (device, { desc }) => [desc(device.purchaseDate)],
  });
}
