/**
 * Signals that some team, org or enterprise setting changed, so every live team
 * subscription can republish its resolved settings. A change made on this
 * instance announces itself directly; one made on another instance arrives
 * through a Mongo change stream. No Meteor imports, so it is testable
 * (tests/settings-changes.test.ts).
 */
import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function onSettingsChanged(listener) {
  emitter.on('changed', listener);
  return () => emitter.off('changed', listener);
}

export function announceSettingsChanged() {
  emitter.emit('changed');
}

const WATCHED_COLLECTIONS = ['teams', 'organizations', 'enterprises'];
// Fields that decide a team's resolved settings, plus the org ticket IDs it publishes.
const RESOLVING_FIELDS =
  '^(settings|parentTeamId|orgId|isPersonal|enterpriseId|ticketPrefix|sourcePrefixes)';
const DEBOUNCE_MS = 100;
const RETRY_MS = 5000;

const startsWithResolvingField = (input) => ({
  $regexMatch: { input, regex: RESOLVING_FIELDS },
});

const SETTINGS_CHANGES = [
  {
    $match: {
      $or: [
        { operationType: { $in: ['insert', 'delete', 'replace'] } },
        {
          $expr: {
            $anyElementTrue: [
              {
                $map: {
                  input: { $objectToArray: { $ifNull: ['$updateDescription.updatedFields', {}] } },
                  in: startsWithResolvingField('$$this.k'),
                },
              },
            ],
          },
        },
        {
          $expr: {
            $anyElementTrue: [
              {
                $map: {
                  input: { $ifNull: ['$updateDescription.removedFields', []] },
                  in: startsWithResolvingField('$$this'),
                },
              },
            ],
          },
        },
      ],
    },
  },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A standalone mongod has no change streams; the in-process signal still works.
function isUnsupported(error) {
  return (
    error?.code === 40573 ||
    error?.codeName === 'CommandNotSupported' ||
    /replica set/i.test(error?.message ?? '')
  );
}

/**
 * Announces a settings change whenever any instance writes one. Resolves `ready`
 * once every stream is open (or has given up), so a caller can write right after.
 */
export function watchSettingsChanges(db, onChange = announceSettingsChanged) {
  let stopped = false;
  let timer = null;
  const streams = new Set();

  const signal = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, DEBOUNCE_MS);
  };

  async function follow(name, started) {
    while (!stopped) {
      const stream = db.collection(name).watch(SETTINGS_CHANGES);
      streams.add(stream);
      try {
        if (await stream.tryNext()) signal();
        started();
        while (await stream.hasNext()) {
          await stream.next();
          signal();
        }
      } catch (error) {
        if (stopped) return;
        started();
        if (isUnsupported(error)) {
          console.warn(`[settings] no change stream for ${name}; other instances will not be heard`);
          return;
        }
        console.error(`[settings] change stream for ${name} failed:`, error);
      } finally {
        streams.delete(stream);
        await stream.close().catch(() => {});
      }
      if (!stopped) await wait(RETRY_MS);
    }
  }

  const ready = Promise.all(
    WATCHED_COLLECTIONS.map((name) => new Promise((resolve) => void follow(name, resolve))),
  );

  return {
    ready,
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await Promise.all([...streams].map((stream) => stream.close().catch(() => {})));
    },
  };
}
