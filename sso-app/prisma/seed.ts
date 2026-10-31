import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  // `||` (not `??`): docker-compose passes an unset variable as an empty string
  const username = process.env.MASTER_USERNAME || "admin";
  const password = process.env.MASTER_PASSWORD || "admin";

  const existing = await db.user.findFirst({ where: { isMaster: true } });
  if (existing) {
    console.log(`Master account already exists: ${existing.username}`);
    return;
  }

  // The placeholder of .env.example is public knowledge: a master account with it would be open to everyone who read the README
  if (password === "admin" || password === "CHANGE-ME-set-a-strong-initial-password") {
    console.error("✗ MASTER_PASSWORD ist noch der Platzhalter bzw. Standardwert – kein Master-Konto angelegt. Bitte ein eigenes, starkes Passwort in .env setzen.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("✗ MASTER_PASSWORD muss mindestens 8 Zeichen lang sein – kein Master-Konto angelegt.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const master = await db.user.create({
    data: {
      username,
      passwordHash,
      isMaster: true,
      forcePasswordChange: password === "admin",
    },
  });

  console.log(`✓ Master account created: ${master.username} (ID: ${master.id})`);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
