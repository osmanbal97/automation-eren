import { Sidebar } from "@/components/Sidebar";

/** Shared shell for every gated screen: fixed aurora/grain backdrop, persistent left
 * nav, and a centered content column. /login sits outside this group so it can render
 * full-bleed. URLs are unaffected -- (dashboard) is a route group, not a path segment. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <div className="aurora" aria-hidden />
      <div className="grain" aria-hidden />

      <div className="mx-auto flex max-w-[100rem] flex-col lg:flex-row">
        <div className="border-b border-line lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
          <Sidebar />
        </div>

        <main className="min-w-0 flex-1 px-6 py-10 lg:px-12">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
