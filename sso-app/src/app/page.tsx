import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();

  if (session) {
    if (session.user.isMaster) redirect("/admin");
    redirect("/settings");
  }

  redirect("/auth/login");
}
