import { Avatar } from "./Avatar";
import { STATUSES } from "./Casualty";
import { Scene } from "./Scene";

const SCENE_IDS = ["minibus-stop", "school-gate", "lunch-break", "road-crash", "home-kitchen", "classroom", "unknown-scene"];
const ROLES = ["casualty", "bystander", "calltaker", "adult", "friend", "player"];
const EMOTIONS = ["calm", "worried", "panicked", "pain", "neutral"];

// Review page: every scene with every casualty status, plus the avatars.
export default function ArtGallery() {
  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Art gallery</h1>

      <section aria-labelledby="av-h" className="mb-8">
        <h2 id="av-h" className="mb-2 text-xl font-semibold">Avatars</h2>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
          {ROLES.map((r) =>
            EMOTIONS.map((e) => (
              <figure key={`${r}-${e}`} className="m-0 text-center text-xs">
                <Avatar role={r} emotion={e} size={56} />
                <figcaption>{r} / {e}</figcaption>
              </figure>
            )),
          )}
        </div>
      </section>

      {SCENE_IDS.map((scene) => (
        <section key={scene} aria-label={scene} className="mb-8">
          <h2 className="mb-2 text-xl font-semibold">{scene}</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {[...STATUSES, "unknown-status"].map((status) => (
              <figure key={status} className="m-0">
                <Scene scene={scene} casualty={status} />
                <figcaption className="text-sm">{scene} / {status}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
