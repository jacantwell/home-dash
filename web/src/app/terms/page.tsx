import type { Metadata } from "next";
import Link from "next/link";

import { REFERENCES, type RefId, SECTIONS, WIKI } from "./content";

export const metadata: Metadata = {
  title: "Terms and Conditions · home-dash",
  description: "The legally binding worm facts you agree to by using home-dash.",
};

function Ref({ n }: { n: RefId }) {
  return (
    <sup id={`cite-${n}`}>
      <a href={`#ref-${n}`}>[{n}]</a>
    </sup>
  );
}

function CitationNeeded() {
  return (
    <sup>
      <i>
        <a href="#references">[citation needed]</a>
      </i>
    </sup>
  );
}

export default function TermsPage() {
  return (
    <main className="raw wiki mx-auto w-full max-w-4xl flex-1 px-4 pb-8">
      <h1>Terms and Conditions</h1>
      <p className="hatnote">
        <i>
          This article is about the terms of use for home-dash. For the animal, see{" "}
          <a href={`${WIKI}Worm`}>Worm</a>. For the Windows 95 screensaver, see{" "}
          <a href={`${WIKI}Screensaver`}>Screensaver</a>.
        </i>
      </p>
      <hr />
      <p>
        <b>Last revised:</b> whenever the worms said so. <b>Effective:</b> retroactively.
      </p>

      <div className="toc" role="navigation" aria-labelledby="toc-heading">
        <b id="toc-heading">Contents</b>
        <ol>
          {SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>
                {i + 1} {s.title}
              </a>
            </li>
          ))}
        </ol>
      </div>

      <h2 id="definitions">1. Definitions</h2>
      <dl>
        <dt>&ldquo;Service&rdquo;</dt>
        <dd>
          home-dash, the website you are looking at, and any <Link href="/board">LED board</Link> it
          may or may not be attached to.
        </dd>
        <dt>&ldquo;Worm&rdquo;</dt>
        <dd>
          Any member of the phylum <a href={`${WIKI}Annelida`}>Annelida</a>, plus anything that
          looks like one if you squint. Includes, without limitation, the{" "}
          <a href={`${WIKI}Lumbricus_terrestris`}>common earthworm</a>, the{" "}
          <a href={`${WIKI}Bobbit_worm`}>bobbit worm</a>, and gummy worms.
          <Ref n={2} />
        </dd>
        <dt>&ldquo;You&rdquo;</dt>
        <dd>The person reading this. Yes, you. The worms can see you.</dd>
        <dt>&ldquo;Segment&rdquo;</dt>
        <dd>
          One of the repeating body units of a worm, or one clause of this agreement. The two are
          legally equivalent.
          <Ref n={4} />
        </dd>
      </dl>

      <h2 id="acceptance">2. Acceptance of Terms</h2>
      <p>
        By loading this page, scrolling past this paragraph, or thinking about a worm at any point
        during the next 30 days, you agree to be bound by these Terms. Worms have no skeleton and
        are therefore not bound by anything.
        <Ref n={1} />
      </p>
      <p>
        If you do not agree, you must close the browser tab and apologise, in writing, to a worm.
        Postal addresses for worms are available on request.
        <CitationNeeded />
      </p>

      <h2 id="the-worms">3. The Worms</h2>
      <p>
        An earthworm has five hearts, which is four more than the Service and approximately five
        more than its developer.
        <Ref n={1} /> Each heart is assigned to a different weekday; the worm takes weekends off.
        <Ref n={3} />
      </p>
      <p>
        Worms breathe through their skin, which is why they are not permitted to wear the{" "}
        <a href={`${WIKI}Windows_XP`}>Windows XP</a> Luna theme. Worms are also fully{" "}
        <a href={`${WIKI}Hermaphrodite`}>hermaphroditic</a> and so are exempt from the &ldquo;sign
        in&rdquo; button, which they find presumptuous.
        <Ref n={2} />
      </p>
      <p>
        There are an estimated 1.4 million worms per acre of decent lawn.
        <Ref n={3} /> When laid end to end they would reach the moon, but they have repeatedly
        declined to do so.
        <CitationNeeded />
      </p>
      <p>
        <a href={`${WIKI}Charles_Darwin`}>Charles Darwin</a> spent 39 years studying worms and
        concluded they were fine.
        <Ref n={1} /> He played the bassoon at them to test their hearing. They did not react, which
        the Service considers a reasonable response to bassoon.
      </p>

      <h2 id="your-obligations">4. Your Obligations</h2>
      <ol>
        <li>You shall not step on a worm after rain. They are commuting.</li>
        <li>
          You shall not refer to a <a href={`${WIKI}Caecilian`}>caecilian</a> as a worm. It is an
          amphibian and it is very tired of this.
        </li>
        <li>
          You shall not attempt to cut a worm in half to &ldquo;make two worms.&rdquo; This does not
          work and the worm will remember.
          <Ref n={5} />
        </li>
        <li>
          You acknowledge that the <a href={`${WIKI}Computer_worm`}>computer worm</a> is not a real
          worm and that the real worms consider the name defamatory.
        </li>
      </ol>

      <h2 id="the-board">5. The Board</h2>
      <p>
        Messages sent to the <Link href="/board">LED board</Link> are displayed in a colour of your
        choosing and read aloud to the worms under the house. Messages are capped at 60 seconds
        because that is the attention span of a worm.
        <Ref n={4} /> Messages the worms dislike are silently replaced with the word
        &ldquo;soil.&rdquo;
      </p>

      <h2 id="liability">6. Limitation of Liability</h2>
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS,&rdquo; MUCH LIKE A WORM, WHICH IS ALSO PROVIDED AS IS.
        TO THE MAXIMUM EXTENT PERMITTED BY SOIL, THE SERVICE SHALL NOT BE LIABLE FOR ANY LOSS OF
        DATA, LOSS OF WORMS, OR GAIN OF WORMS.
      </p>
      <p>
        In no event shall aggregate liability exceed the market value of one (1) medium worm,
        currently £0.00.
        <Ref n={3} />
      </p>

      <h2 id="termination">7. Termination and Segmentation</h2>
      <p>
        Either party may terminate this agreement at any time. If any clause is found to be
        unenforceable, it shall be severed, and the remaining clauses shall regenerate a new head
        within two to three weeks.
        <Ref n={5} />
      </p>

      <h2 id="governing-law">8. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the topsoil and any disputes shall be settled in the{" "}
        <a href={`${WIKI}Wormhole`}>wormhole</a> of competent jurisdiction. The parties consent to
        the process being slow, damp, and dark.
      </p>

      <h2 id="references">9. References</h2>
      <ol className="references">
        {REFERENCES.map((r) => (
          <li key={r.id} id={`ref-${r.id}`}>
            <a href={`#cite-${r.id}`} aria-label={`Jump up to citation ${r.id}`}>
              ^
            </a>{" "}
            {r.text}
          </li>
        ))}
      </ol>
      <hr />
      <p>
        <a href="#top">Return to top</a> &middot; <Link href="/">Index of /</Link>
      </p>
      <address>
        This page was last edited by a worm. Text is available under the Creative Compost Licence.
      </address>
    </main>
  );
}
