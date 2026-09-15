import { Suspense } from "react";
import NewEssayQuestionClient from "./NewEssayQuestionClient";
import Spinner from "@/components/Spinner";

export default function NewEssayQuestionPage() {
  return (
    <Suspense fallback={<Spinner label="불러오는 중이에요..." />}>
      <NewEssayQuestionClient />
    </Suspense>
  );
}
