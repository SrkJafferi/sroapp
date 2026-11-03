import Link from 'next/link';
import Image from 'next/image';
import { Heart, Users, ShieldCheck } from 'lucide-react';

export function LoginExperience({ children }: { children: React.ReactNode }) {
  return (
    <main className="login-experience">
      <Image
        className="login-clinic-photo"
        src="/login-clinic-background.avif"
        unoptimized
        alt=""
        fill
        priority
        sizes="100vw"
      />
      <section className="login-brand-story" aria-label="SRO Clinic">
        <Link href="/auth/welcome" className="login-original-logo">
          <Image
            src="/sro-logo.png"
            alt="Social Responsibility Organization"
            width={300}
            height={126}
            priority
          />
          <span>CLINIC MANAGEMENT</span>
        </Link>
        <div className="login-brand-copy">
          <h1>
            Care that
            <br />
            connects.
            <br />
            <em>People who matter.</em>
          </h1>
          <p>
            Compassionate healthcare,
            <br />
            connected patients, and a<br />
            stronger community.
          </p>
          <div className="login-benefits">
            {[
              {
                Icon: Heart,
                title: 'Thoughtful care',
                text: 'From the first visit to every follow-up.',
              },
              {
                Icon: Users,
                title: 'Your health, organized',
                text: 'A connected view of your care journey.',
              },
              {
                Icon: ShieldCheck,
                title: 'A stronger community',
                text: 'Better lives through responsible care.',
              },
            ].map(({ Icon, title, text }) => (
              <div key={title}>
                <span>
                  <Icon size={27} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <small>{text}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="login-centered-form" aria-label="Secure clinic access">
        {children}
      </section>
      <aside className="login-trust">
        <span>
          <Users size={29} />
        </span>
        <p>
          Care for you.
          <br />
          <strong>Connected</strong>
          <br />
          every day.
          <i />
        </p>
      </aside>
      <aside className="login-photo-quote">
        <span aria-hidden="true">“</span>
        <p>
          Healthier lives.
          <br />
          Brighter tomorrows.
        </p>
        <i />
      </aside>
      <footer className="login-brand-footer">
        <span aria-hidden="true">● ● ● ●</span>
        <p>
          Social Responsibility Organization
          <br />
          Pakistan
        </p>
      </footer>
    </main>
  );
}
