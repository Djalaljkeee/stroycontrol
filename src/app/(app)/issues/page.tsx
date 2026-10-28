import { redirect } from 'next/navigation';

// Списания объединены с приходом: приход вводится сразу на конструктив.
export default function IssuesPage() {
  redirect('/deliveries');
}
