import { LoginForm } from "@/components/LoginForm";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return <LoginForm next={params.next ?? "/"} />;
}
