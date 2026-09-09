import { Suspense } from "react";
import LoginForm from "./LoginForm";
import Spinner from "@/components/Spinner";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <Spinner />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
