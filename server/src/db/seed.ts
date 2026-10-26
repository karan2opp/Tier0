import "../loadEnv";
import { sql } from "drizzle-orm";
import { logger } from "../common/logger";
import { db, pool } from "./client";
import { customers, devices, repairTickets, ticketEvents, warranties } from "./schema";

/**
 * Fictional demo data. All dates are relative to "now", so pickups stay "tomorrow" and
 * warranties stay active whenever the demo runs. Re-running the seed resets the data.
 */

type TicketStatus = (typeof repairTickets.$inferInsert)["status"] & string;

const DAY = 24 * 60 * 60 * 1000;

/** A moment N days from now (negative = past), optionally at a given local hour. */
function daysFromNow(days: number, hour?: number): Date {
  const date = new Date(Date.now() + days * DAY);
  if (hour !== undefined) date.setHours(hour, 0, 0, 0);
  return date;
}

/** Postgres `date` column value (YYYY-MM-DD) N days from now. */
function dateFromNow(days: number): string {
  return daysFromNow(days).toISOString().slice(0, 10);
}

const YEAR = 365;

async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database");
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE ticket_events, repair_tickets, warranties, devices, customers RESTART IDENTITY CASCADE`);

    /* ---------------- Customers ---------------- */
    const people = await tx
      .insert(customers)
      .values([
        { fullName: "Aarav Sharma", email: "aarav.sharma@example.com", phone: "+91 90000 00001", city: "Bengaluru" },
        { fullName: "Priya Nair", email: "priya.nair@example.com", phone: "+91 90000 00002", city: "Kochi" },
        { fullName: "Rohan Mehta", email: "rohan.mehta@example.com", phone: "+91 90000 00003", city: "Mumbai" },
        { fullName: "Ananya Iyer", email: "ananya.iyer@example.com", phone: "+91 90000 00004", city: "Chennai" },
        { fullName: "Vikram Singh", email: "vikram.singh@example.com", phone: "+91 90000 00005", city: "Delhi" },
        { fullName: "Meera Kulkarni", email: "meera.kulkarni@example.com", phone: "+91 90000 00006", city: "Pune" },
        { fullName: "Arjun Reddy", email: "arjun.reddy@example.com", phone: "+91 90000 00007", city: "Hyderabad" },
        { fullName: "Sneha Das", email: "sneha.das@example.com", phone: "+91 90000 00008", city: "Kolkata" },
      ])
      .returning();
    const person = (name: string) => people.find((p) => p.fullName === name)!;

    /* ---------------- Laptops ---------------- */
    const laptops = await tx
      .insert(devices)
      .values([
        // Demo customer: same model as the demo laptop, warranty active, no tickets yet.
        { customerId: person("Aarav Sharma").id, brand: "Acer", model: "Aspire 7 A715-79G", serialNumber: "NHQN4SI00134501", purchaseDate: dateFromNow(-300) },
        { customerId: person("Priya Nair").id, brand: "Dell", model: "Inspiron 15 3520", serialNumber: "DL3520IN88213", purchaseDate: dateFromNow(-2 * YEAR) },
        { customerId: person("Rohan Mehta").id, brand: "HP", model: "Pavilion 14-dv2", serialNumber: "5CD2419XKQ", purchaseDate: dateFromNow(-240) },
        { customerId: person("Ananya Iyer").id, brand: "Lenovo", model: "IdeaPad Slim 5 14IRL8", serialNumber: "PF4KX9ZD", purchaseDate: dateFromNow(-420) },
        { customerId: person("Vikram Singh").id, brand: "ASUS", model: "TUF Gaming F15 FX507", serialNumber: "R6NRCX03A114", purchaseDate: dateFromNow(-180) },
        { customerId: person("Meera Kulkarni").id, brand: "Acer", model: "Swift 3 SF314-512", serialNumber: "NXK0EER00921", purchaseDate: dateFromNow(-3 * YEAR) },
        { customerId: person("Arjun Reddy").id, brand: "Dell", model: "XPS 13 9340", serialNumber: "DLXPS9340H7Q", purchaseDate: dateFromNow(-30) },
        { customerId: person("Arjun Reddy").id, brand: "HP", model: "Victus 16-r0", serialNumber: "5CG3302MZT", purchaseDate: dateFromNow(-600) },
        // Warranty expires in about a month: good for "is my warranty about to end?".
        { customerId: person("Sneha Das").id, brand: "Lenovo", model: "ThinkPad E14 Gen 5", serialNumber: "PW0A7B3C", purchaseDate: dateFromNow(-335) },
      ])
      .returning();
    const laptop = (serial: string) => laptops.find((d) => d.serialNumber === serial)!;

    /* ---------------- Warranties ---------------- */
    const warrantyFor = (serial: string, years: number, plan: "standard" | "extended" | "accidental_damage", accidental = false) => {
      const device = laptop(serial);
      const start = new Date(device.purchaseDate);
      const end = new Date(start.getTime() + years * YEAR * DAY);
      return {
        deviceId: device.id,
        plan,
        startsOn: device.purchaseDate,
        endsOn: end.toISOString().slice(0, 10),
        coversAccidentalDamage: accidental,
      };
    };

    await tx.insert(warranties).values([
      warrantyFor("NHQN4SI00134501", 1, "standard"), // active (~65 days left)
      warrantyFor("DL3520IN88213", 1, "standard"), // expired a year ago
      warrantyFor("5CD2419XKQ", 2, "accidental_damage", true), // active, covers accidents
      warrantyFor("PF4KX9ZD", 2, "extended"), // active (extended to 2 years)
      warrantyFor("R6NRCX03A114", 1, "standard"), // active
      warrantyFor("NXK0EER00921", 1, "standard"), // expired long ago
      warrantyFor("DLXPS9340H7Q", 1, "standard"), // brand new
      warrantyFor("5CG3302MZT", 1, "standard"), // expired
      warrantyFor("PW0A7B3C", 1, "standard"), // expires in ~30 days
    ]);

    /* ---------------- Repair tickets with history ---------------- */
    const createTicket = async (
      ticket: Omit<typeof repairTickets.$inferInsert, "status"> & { status: TicketStatus },
      history: Array<[status: TicketStatus, note: string, daysAgo: number]>,
    ) => {
      const [created] = await tx.insert(repairTickets).values(ticket).returning();
      await tx.insert(ticketEvents).values(
        history.map(([status, note, daysAgo]) => ({ ticketId: created.id, status, note, createdAt: daysFromNow(-daysAgo) })),
      );
    };

    // Repair in progress, out of warranty, paid.
    await createTicket(
      {
        ticketNumber: "T0-1041",
        customerId: person("Priya Nair").id,
        deviceId: laptop("DL3520IN88213").id,
        issue: "Several keyboard keys not working",
        diagnosis: "Keyboard ribbon cable damaged; keyboard replacement needed",
        status: "repairing",
        coveredByWarranty: false,
        estimatedCostInr: 2800,
        estimatedReadyAt: daysFromNow(1, 18),
        deliveryWindowStart: daysFromNow(2, 10),
        deliveryWindowEnd: daysFromNow(2, 13),
      },
      [
        ["created", "Customer reported keys not responding", 6],
        ["pickup_scheduled", "Pickup booked", 6],
        ["picked_up", "Laptop collected from customer", 5],
        ["diagnosing", "Technician inspecting keyboard", 4],
        ["repairing", "Customer approved the quote of Rs 2,800; replacing keyboard", 2],
      ],
    );

    // Covered by accidental damage protection, waiting for a part (a delay to explain).
    await createTicket(
      {
        ticketNumber: "T0-1042",
        customerId: person("Rohan Mehta").id,
        deviceId: laptop("5CD2419XKQ").id,
        issue: "Screen cracked after a fall",
        diagnosis: "Display panel broken; replacement covered by accidental damage protection",
        status: "awaiting_parts",
        coveredByWarranty: true,
        estimatedCostInr: 0,
        estimatedReadyAt: daysFromNow(5, 18),
      },
      [
        ["created", "Customer reported a cracked screen", 4],
        ["pickup_scheduled", "Pickup booked", 4],
        ["picked_up", "Laptop collected from customer", 3],
        ["diagnosing", "Panel damage confirmed", 3],
        ["awaiting_parts", "Replacement display panel ordered from HP; expected in 3 to 4 days", 2],
      ],
    );

    // Pickup tomorrow morning.
    await createTicket(
      {
        ticketNumber: "T0-1043",
        customerId: person("Ananya Iyer").id,
        deviceId: laptop("PF4KX9ZD").id,
        issue: "Laptop overheats and shuts down during video calls",
        status: "pickup_scheduled",
        coveredByWarranty: true,
        pickupWindowStart: daysFromNow(1, 10),
        pickupWindowEnd: daysFromNow(1, 12),
      },
      [
        ["created", "Escalated by Tier0 after diagnostics: firmware throttling and sudden shutdowns", 1],
        ["pickup_scheduled", "Pickup booked for tomorrow 10 AM to 12 PM", 1],
      ],
    );

    // Repaired, waiting for delivery.
    await createTicket(
      {
        ticketNumber: "T0-1044",
        customerId: person("Vikram Singh").id,
        deviceId: laptop("R6NRCX03A114").id,
        issue: "Battery not charging",
        diagnosis: "Faulty charging port; replaced under warranty",
        status: "ready_for_delivery",
        coveredByWarranty: true,
        estimatedCostInr: 0,
        estimatedReadyAt: daysFromNow(0, 11),
        deliveryWindowStart: daysFromNow(2, 14),
        deliveryWindowEnd: daysFromNow(2, 17),
      },
      [
        ["created", "Customer reported the laptop does not charge", 7],
        ["pickup_scheduled", "Pickup booked", 7],
        ["picked_up", "Laptop collected from customer", 6],
        ["diagnosing", "Charging port fault found", 5],
        ["repairing", "Replacing charging port", 3],
        ["quality_check", "Charging and battery tested for 24 hours", 1],
        ["ready_for_delivery", "Repair complete; delivery being scheduled", 0],
      ],
    );

    // Completed last week.
    await createTicket(
      {
        ticketNumber: "T0-1045",
        customerId: person("Meera Kulkarni").id,
        deviceId: laptop("NXK0EER00921").id,
        issue: "Loud fan noise",
        diagnosis: "Fan bearing worn; fan replaced and cooling paste renewed",
        status: "delivered",
        coveredByWarranty: false,
        estimatedCostInr: 1500,
        deliveryWindowStart: daysFromNow(-7, 11),
        deliveryWindowEnd: daysFromNow(-7, 14),
      },
      [
        ["created", "Customer reported loud fan noise", 15],
        ["picked_up", "Laptop collected from customer", 14],
        ["repairing", "Replacing fan, quote of Rs 1,500 approved", 12],
        ["quality_check", "Thermals tested under load", 9],
        ["out_for_delivery", "Out for delivery", 7],
        ["delivered", "Delivered and signed for", 7],
      ],
    );

    // Being diagnosed right now.
    await createTicket(
      {
        ticketNumber: "T0-1046",
        customerId: person("Arjun Reddy").id,
        deviceId: laptop("5CG3302MZT").id,
        issue: "Random blue screens while gaming",
        status: "diagnosing",
        coveredByWarranty: false,
        estimatedReadyAt: daysFromNow(3, 18),
      },
      [
        ["created", "Customer reported blue screens with code 0x116", 3],
        ["picked_up", "Laptop collected from customer", 2],
        ["diagnosing", "Running graphics stress tests and memory diagnostics", 1],
      ],
    );
  });

  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM customers) AS customers,
      (SELECT count(*) FROM devices) AS devices,
      (SELECT count(*) FROM warranties) AS warranties,
      (SELECT count(*) FROM repair_tickets) AS repair_tickets,
      (SELECT count(*) FROM ticket_events) AS ticket_events`);
  logger.info(counts.rows[0], "Database seeded");
}

seed()
  .catch((err) => {
    logger.error({ err }, "Seeding failed");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
