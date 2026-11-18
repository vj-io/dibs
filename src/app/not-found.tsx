import { AppHeader, Footer, LinkButton, Scribble } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 pt-16 text-center">
        <div className="relative">
          <p className="font-mono text-7xl font-bold">404</p>
          <Scribble className="absolute -inset-x-4 top-1/2 h-10 -translate-y-1/2 text-pink" />
        </div>
        <h1 className="mt-6 text-3xl">Someone already called dibs on this page.</h1>
        <p className="mt-3 text-muted">Or it never existed. Either way, there&apos;s nothing here.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <LinkButton href="/" variant="primary">Go home</LinkButton>
          <LinkButton href="/try" variant="ghost">Try the live demo</LinkButton>
        </div>
      </main>
      <Footer />
    </>
  );
}
