import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CalendarDays, FolderOpen, Heart, ShieldCheck, UserRound } from 'lucide-react';
import styles from './welcome-experience.module.css';

function WelcomeBrand({ outer = false }: { outer?: boolean }) {
  return (
    <Link
      href="/auth/welcome"
      className={`${styles.brand} ${outer ? styles.outerBrand : ''}`}
      aria-label="SRO Clinic welcome"
    >
      <Image
        src="/sro-logo.png"
        alt="Social Responsibility Organization"
        width={989}
        height={415}
        sizes="(max-width: 900px) 240px, 18vw"
      />
      <span>CLINIC MANAGEMENT</span>
    </Link>
  );
}

export function WelcomeHeroLeft() {
  return (
    <section className={styles.story} aria-labelledby="welcome-heading">
      <WelcomeBrand outer />
      <div className={styles.introduction}>
        <p className={styles.eyebrow}>HEALTHCARE FOR A BETTER TOMORROW</p>
        <h1 id="welcome-heading">
          Welcome to
          <br />
          <em>SRO Clinic</em>
        </h1>
        <p className={styles.description}>
          Connected care for healthier lives. A modern clinic experience that keeps you, your care,
          and your health journey together.
        </p>
      </div>
      <ul className={styles.features}>
        {[
          {
            Icon: Heart,
            title: 'Connected care',
            text: 'A coordinated care experience with your clinic team.',
          },
          {
            Icon: FolderOpen,
            title: 'Organized health records',
            text: 'Your health information, in one secure place.',
          },
          {
            Icon: CalendarDays,
            title: 'Easy appointments',
            text: 'Book, manage, and stay on top of your care.',
          },
          {
            Icon: ShieldCheck,
            title: 'Secure & private',
            text: 'Your health data is protected, always.',
          },
        ].map(({ Icon, title, text }) => (
          <li key={title}>
            <span className={styles.featureIcon}>
              <Icon aria-hidden="true" strokeWidth={1.8} />
            </span>
            <div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WelcomeAuthCard({ showDiscoveryNotice }: { showDiscoveryNotice: boolean }) {
  return (
    <section id="welcome-card" className={styles.card} aria-labelledby="care-journey-heading">
      <WelcomeBrand />
      <span className={styles.badge}>SECURE CLINIC ACCESS</span>
      <h2 id="care-journey-heading">Start your care journey</h2>
      <p className={styles.cardDescription}>
        Sign in to access your clinic, or register
        <br className={styles.desktopBreak} /> as a patient to get started.
      </p>
      <Link href="/auth/login" className={styles.primary}>
        Sign in <ArrowRight aria-hidden="true" size={22} />
      </Link>
      <div className={styles.divider}>
        <span>or</span>
      </div>
      <Link href="/auth/register" className={styles.secondary}>
        <UserRound aria-hidden="true" size={25} />
        Register as a patient
      </Link>
      <Link href="/auth/welcome?explore=clinics#clinic-discovery" className={styles.explore}>
        Explore clinics <ArrowRight aria-hidden="true" size={18} />
      </Link>
      {showDiscoveryNotice && (
        <section
          id="clinic-discovery"
          className={styles.discoveryNotice}
          aria-labelledby="discovery-heading"
          tabIndex={-1}
        >
          <h3 id="discovery-heading">Explore clinics</h3>
          <p>
            Web clinic discovery is coming soon. You can sign in to access your clinic workspace.
          </p>
          <Link href="/auth/welcome#welcome-card">Back to welcome</Link>
        </section>
      )}
      <p className={styles.reassurance}>
        <ShieldCheck aria-hidden="true" size={24} />
        <span>Secure access · Your care, connected</span>
      </p>
    </section>
  );
}

export function WelcomeDoctorPanel() {
  return (
    <aside className={styles.doctorPanel} aria-label="Connected care">
      <blockquote>
        <span aria-hidden="true">“</span>
        <p>
          Compassionate care.
          <br />A healthier, brighter
          <br className={styles.desktopBreak} /> tomorrow.
        </p>
        <i aria-hidden="true" />
      </blockquote>
    </aside>
  );
}

export function WelcomeExperience({
  showDiscoveryNotice = false,
}: {
  showDiscoveryNotice?: boolean;
}) {
  return (
    <main className={styles.page}>
      {/* Original approved AVIF: no recompression, screenshots or interface baked into the asset. */}
      <Image
        src="/login-clinic-background.avif"
        alt=""
        fill
        unoptimized
        preload
        sizes="100vw"
        className={styles.photo}
      />
      <WelcomeHeroLeft />
      <WelcomeAuthCard showDiscoveryNotice={showDiscoveryNotice} />
      <WelcomeDoctorPanel />
      <footer className={styles.footer}>
        <span aria-hidden="true">● ● ● ●</span>
        <span>Social Responsibility Organization · Pakistan</span>
      </footer>
    </main>
  );
}
