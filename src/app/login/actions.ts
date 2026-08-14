"use server";

import { redirect } from "next/navigation";
import { verifyPassword, login as loginSession, logout as logoutSession } from "@/security/auth";

export async function loginAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const ok = await verifyPassword(password);
  if (!ok) return { error: "Incorrect password." };

  await loginSession();
  redirect(String(formData.get("next") || "/"));
}

export async function logoutAction() {
  await logoutSession();
  redirect("/login");
}
