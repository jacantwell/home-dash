import { clerkMiddleware } from "@clerk/nextjs/server";

// Attaches Clerk auth state to every request. Protection happens at the
// resource (see app/board/page.tsx), not by path matching here.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next internals and static assets unless they show up in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
