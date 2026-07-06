import { auth } from "@/auth";
import { NextResponse } from "next/server";

const publicRoutes = ["/login", "/signup", "/verify-otp"];
const onboardingRoute = "/onboarding";

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const hasHandle = !!(req.auth?.user as any)?.handle;
  const isPublicRoute = publicRoutes.includes(nextUrl.pathname);
  const isOnboardingRoute = nextUrl.pathname === onboardingRoute;
  const isApiAuthRoute = nextUrl.pathname.startsWith("/api/auth");

  // Allow API auth routes
  if (isApiAuthRoute) return;

  if (isLoggedIn) {
    if (!hasHandle && !isOnboardingRoute) {
      // User is logged in but has no handle, force them to onboarding
      return NextResponse.redirect(new URL(onboardingRoute, nextUrl));
    }
    
    if (hasHandle && (isOnboardingRoute || isPublicRoute)) {
      // User is fully onboarded, redirect away from auth/onboarding pages
      return NextResponse.redirect(new URL("/curated", nextUrl));
    }
  }

  return;
});

// Optionally, don't invoke Middleware on some paths
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
