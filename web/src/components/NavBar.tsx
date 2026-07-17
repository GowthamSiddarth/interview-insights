import Link from 'next/link';

// Rendered once, in the root layout — present on every route. Each
// page keeps its own title/description (page-specific); only the
// genuinely shared navigation (home, search) lives here.
export function NavBar() {
  return (
    <nav className="border-b border-gray-200 dark:border-gray-700">
      <div className="mx-auto flex max-w-2xl items-center gap-4 px-8 py-3 text-sm">
        <Link href="/" className="font-semibold">
          Interview Insights
        </Link>
        <Link
          href="/search"
          className="text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Search companies &amp; reviews
        </Link>
      </div>
    </nav>
  );
}
