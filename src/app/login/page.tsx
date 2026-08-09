import { Suspense } from "react";
import { getT } from "@/lib/i18n";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const { t } = await getT();

  return (
    <Suspense>
      <LoginForm dict={t.login} />
    </Suspense>
  );
}
