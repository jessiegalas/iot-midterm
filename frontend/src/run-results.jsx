import React, { useState } from 'react';
import { CircuitBoard, Radio, ShieldCheck } from 'lucide-react';
import { HINT_COSTS } from './expert-manual';
import { clock } from './game';
import { LegacyScores } from './legacy-scores';
import { useLeaderboard } from './scores';

const statusLabel = {
  won: 'Cleared', lost: 'Failed', aborted: 'Aborted', interrupted: 'Interrupted', active: 'In progress',
};
const lossLabel = { TIME: 'Time expired', WIRE: 'Wrong wire', CODE: 'Three incorrect codes' };
const accuracy = run => run.accuracy == null ? '—' : Math.round(run.accuracy * 100) + '%';
const timeLeft = run => run.remaining == null ? '—' : clock(run.remaining);
const points = run => run.score == null ? '—' : run.score.toLocaleString();
const medals = [ShieldCheck, CircuitBoard, Radio];

export function RunResult({ run }) {
  if (!run) return null;
  const hintCost = HINT_COSTS[0] * run.firstHints + HINT_COSTS[1] * run.secondHints;
  return (
    <section className="run-result" aria-label="Run result">
      <dl className="run-metrics">
        <div><dt>Score</dt><dd>{points(run)}</dd></div>
        <div><dt>Time left</dt><dd>{timeLeft(run)}</dd></div>
        <div><dt>Accuracy</dt><dd>{accuracy(run)}</dd></div>
        <div><dt>Hints used</dt><dd>{run.hintsUsed ?? '—'}</dd></div>
      </dl>
      <p className="run-score-detail">
        {run.levelsCleared} of 3 levels cleared
        {run.decisions > 0 && <> · {run.correct} of {run.decisions} decisions correct</>}
        {hintCost > 0 && <> · −{hintCost} hint points</>}
      </p>
    </section>
  );
}

function Podium({ winners, loading }) {
  return (
    <section className="podium-panel" aria-labelledby="podium-title">
      <h2 id="podium-title">Top finishers</h2>
      {winners.length === 0 && <p className="rankings-note">{loading ? 'Loading scores…' : 'Clear all three levels to earn a podium spot.'}</p>}
      <ol className="podium" aria-label="Top three ranks" role="list">
        {medals.map((Icon, index) => {
          const run = winners[index];
          const rank = index + 1;
          return (
            <li key={rank} className="podium-place" data-rank={rank}>
              <span className="sr-only">Rank {rank}</span>
              <span className="podium-icon"><Icon aria-hidden="true" size={30} strokeWidth={1.6} /></span>
              <div className="podium-details">
                <strong>{run?.team ?? 'Open spot'}</strong>
                {run && <>
                  <p className="podium-points">{points(run)} points</p>
                  <p>{timeLeft(run)} left · {accuracy(run)} accuracy</p>
                </>}
              </div>
              <div className="podium-step" aria-hidden="true">{rank}</div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Leaderboard({ currentId, active, onPlay }) {
  const [page, setPage] = useState(1);
  const { data, error } = useLeaderboard(page);
  const { podium = [], runs = [], page: currentPage = 1, pages = 1 } = data ?? {};
  return (
    <section className="leaderboard" aria-label="Saved runs">
      <div className="leaderboard-heading">
        <p>Clear all three levels to rank. Higher scores place first.</p>
        {!active && <button className="button button-primary" onClick={onPlay}>Connect players</button>}
      </div>
      {error && <p className="notice" role="status">{data
        ? 'The score database could not be reached. Showing the last available results.'
        : 'The score database could not be reached.'}</p>}
      <Podium winners={podium} loading={!data && !error} />
      <section className="all-runs" aria-labelledby="all-runs-title">
        <h2 id="all-runs-title">All runs</h2>
        {runs.length ? (
          <div className="run-table-wrap" tabIndex={0} role="region" aria-label="Run history">
            <table className="run-table" aria-labelledby="all-runs-title">
              <thead><tr>
                <th scope="col">Team</th><th scope="col">Result</th><th scope="col">Rank</th><th scope="col">Score</th>
                <th scope="col">Time left</th><th scope="col">Accuracy</th><th scope="col">Hints</th>
              </tr></thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.id} data-current={run.id === currentId || undefined}>
                    <th scope="row">
                      {run.team}
                      <span className="run-detail">{new Date(run.date).toLocaleDateString()}</span>
                    </th>
                    <td>
                      <span data-result={run.status}>{statusLabel[run.status]}</span>
                      <span className="run-detail">
                        {run.levelsCleared}/3 levels{run.loss && <> · {lossLabel[run.loss]}</>}
                      </span>
                    </td>
                    <td>{run.rank ?? '—'}</td><td><strong>{points(run)}</strong></td>
                    <td>{timeLeft(run)}</td>
                    <td title={run.decisions > 0 ? run.correct + ' of ' + run.decisions + ' correct' : undefined}>{accuracy(run)}</td>
                    <td>{run.hintsUsed ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="rankings-note">{!data && !error ? 'Loading runs…' : 'Real games will appear here as they start.'}</p>}
        {pages > 1 && <nav className="run-pagination" aria-label="Run pages">
          <button className="button button-quiet" disabled={currentPage <= 1 || page !== currentPage}
            onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span aria-live="polite">Page {currentPage} of {pages}</span>
          <button className="button button-quiet" disabled={currentPage >= pages || page !== currentPage}
            onClick={() => setPage(currentPage + 1)}>Next</button>
        </nav>}
      </section>
      <p className="local-note">Runs are saved on the host laptop.</p>
      <LegacyScores />
    </section>
  );
}
