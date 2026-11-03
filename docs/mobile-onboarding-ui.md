# Mobile splash and welcome screens

Current genuine emulator comparison, real HTTPS-only WebView integration and remaining delivery gates: [Final verification](onboarding-final-verification.md). The original implementation notes below describe the earlier revision; the final entry flow now opens the real WebApp rather than the prototype login.

Implemented 2 November 2026 against the two supplied 941 × 1672 reference images.

- `/` renders the animated splash; tap anywhere to continue, or it advances after 2.6 seconds.
- `/welcome` renders Patient, Doctor and Admin cards and the email/password CTA. Cards select the existing mobile role and open the existing login route. They do not create authenticated sessions or grant backend privileges.
- `apps/mobile/src/onboarding/screens.tsx` contains both screens and splash fade/scale animation. Reduced motion is respected.
- `components.tsx` provides Brand, RoleOptionCard, BrandedSignInButton, CareTagline and PagerDots.
- `DecorativeBackground.tsx` draws orbital lines, plus symbols, dots, pastel glows and layered waves using native SVG. Screen screenshots are not embedded as the UI.
- `theme.ts` centralizes the onboarding palette, fonts, corner radii, spacing and shadows.
- `assets/sro-onboarding-brand.png` is the isolated organization logo extracted from supplied Image A, retaining the reference's circular branding. All titles, cards, controls and backgrounds are independently rendered native components.

The layout scales around a 400dp reference width, caps scaling for tablets, respects native safe areas and allows vertical scrolling on shorter screens or with enlarged text. Real OS status-bar time/icons remain native rather than reproducing a fake clock.

Verification: mobile TypeScript, targeted ESLint and Android production JavaScript/Hermes export passed (4,045 modules, 46 assets). Export is in the ignored `artifacts/mobile-onboarding-export` folder. No dependency installation, database change, Web UI change or APK rebuild. On-device screenshot comparison remains necessary before claiming pixel-exact native parity. Existing mobile authentication remains its existing implementation; this task changes the two entry screens only.

Run the existing Expo development app with `pnpm --filter @sro/mobile dev`, then open it in the existing compatible development client. Use `/welcome` to revisit role selection. The installed standalone APK will not receive source changes through Fast Refresh.
