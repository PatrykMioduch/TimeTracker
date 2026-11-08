import type { Project, TimeEntry } from "../types";
import { icon, ProjectTag } from "./layout";
import { projectColor } from "../lib/colors";
import { dayLabel, formatDuration, localTime, rangeLabel, weekRange } from "../lib/time";

/** Pasek „Nad czym pracujesz?” — tryb timera i tryb ręczny (jak w Clockify). */
export function EntryBar(props: {
  projects: Project[];
  today: string;
  back: string;
  running: TimeEntry | null;
  fixedProject?: Project;
}) {
  const { projects, today, back, running, fixedProject } = props;

  if (running) {
    return (
      <div class="card entrybar running">
        <div class="eb-note">
          <b>{running.note || <span class="muted">(bez opisu)</span>}</b>
        </div>
        <ProjectTag id={running.project_id} name={running.project_name} color={running.project_color} />
        <span class="eb-clock" data-started-at={running.started_at}>00:00:00</span>
        <form method="post" action="/timer/stop" style="margin:0">
          <input type="hidden" name="back" value={back} />
          <button class="danger" type="submit">STOP</button>
        </form>
      </div>
    );
  }

  if (projects.length === 0 && !fixedProject) {
    return (
      <div class="card empty">
        <b>Nie masz jeszcze żadnego projektu</b>
        Najpierw <a href="/projects">dodaj projekt</a>, potem możesz zapisywać czas.
      </div>
    );
  }

  const disabled = fixedProject ? !fixedProject.active : false;

  return (
    <form method="post" action="/entries" class="card entrybar" data-entrybar>
      <input type="hidden" name="back" value={back} />
      <input class="eb-note" type="text" name="note" maxlength={200} placeholder="Nad czym pracujesz?" />
      {fixedProject ? (
        <>
          <input type="hidden" name="project" value={fixedProject.id} />
          <span class="eb-project"><ProjectTag id={fixedProject.id} name={fixedProject.name} color={fixedProject.color} /></span>
        </>
      ) : (
        <span class="eb-project">
          <i class="dot" data-dot style={`background:${projectColor(projects[0].id, projects[0].color)}`}></i>
          <select name="project" required data-project>
            {projects.map((p) => <option value={p.id} data-color={projectColor(p.id, p.color)}>{p.name}</option>)}
          </select>
        </span>
      )}

      <span class="eb-manual" data-mode="manual">
        <input type="time" name="start" title="Od" data-start />
        <span class="muted">–</span>
        <input type="time" name="end" title="Do" data-end />
        <input type="date" name="date" value={today} required title="Data" />
        <input type="text" name="duration" placeholder="0:00" title="Czas trwania (np. 1:30, 1.5, 90m)" class="eb-dur" data-dur />
        <button type="submit" disabled={disabled}>DODAJ</button>
      </span>

      <span class="eb-timer" data-mode="timer">
        <span class="eb-clock muted">00:00:00</span>
        <button type="submit" formaction="/timer/start" disabled={disabled}>START</button>
      </span>

      <span class="eb-modes">
        <button type="button" class="icon" data-set-mode="timer" title="Timer">{icon("clock")}</button>
        <button type="button" class="icon" data-set-mode="manual" title="Wpisz ręcznie">{icon("edit")}</button>
      </span>
    </form>
  );
}

export const ENTRY_CSS = `
.entrybar{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;flex-wrap:wrap}
.entrybar .eb-note{flex:1 1 220px;border:none;height:40px;font-size:15px;padding:0}
.entrybar input.eb-note:focus{box-shadow:none}
.entrybar div.eb-note{display:flex;align-items:center}
.eb-project{display:inline-flex;align-items:center;gap:8px;min-width:160px;max-width:240px;padding-left:12px;border-left:1px solid var(--line)}
.eb-project select{border:none;height:36px;padding:0 4px;font-weight:500;color:var(--ink-2);background:transparent}
.eb-project select:focus{box-shadow:none}
.eb-manual,.eb-timer{display:inline-flex;align-items:center;gap:8px;padding-left:12px;border-left:1px solid var(--line);flex-wrap:wrap}
.eb-manual input[type=time]{width:96px}.eb-manual input[type=date]{width:140px}.eb-dur{width:72px!important;text-align:center;font-weight:600}
.eb-clock{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;min-width:90px;text-align:center}
.entrybar.running .eb-clock{color:var(--ink)}
.eb-modes{display:inline-flex;flex-direction:column;gap:0}
.eb-modes .icon{height:22px;width:26px}
.eb-modes .icon.on{color:var(--accent)}
[data-entrybar][data-current=timer] [data-mode=manual],[data-entrybar][data-current=manual] [data-mode=timer]{display:none}
[data-entrybar]:not([data-current]) [data-mode=manual]{display:none}
.week-head{display:flex;align-items:baseline;justify-content:space-between;margin:26px 2px 10px}
.week-head b{font-size:13px;color:var(--ink-2)}
.week-head span{font-size:13px;color:var(--muted)}
.day{padding:0;overflow:hidden;margin-bottom:12px}
.day-head{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#fafbfc;border-bottom:1px solid var(--line-2);font-weight:600;color:var(--ink-2);font-size:13px}
.day-head .dur{color:var(--ink)}
.erow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,220px) 120px 80px 104px;align-items:center;gap:12px;padding:8px 10px 8px 16px;border-bottom:1px solid var(--line-2)}
.erow:last-child{border-bottom:none}
.erow:hover{background:#fcfcfd}
.erow .note{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.erow .who{font-size:12px;color:var(--muted)}
.erow .range{color:var(--muted);font-variant-numeric:tabular-nums;font-size:13px;text-align:center}
.erow .dur{text-align:right}
.erow .acts{display:flex;justify-content:flex-end;gap:2px}
.erow .acts form{margin:0}
@media (max-width:860px){
  .erow{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"n d" "p a" "r a";row-gap:2px;padding:10px 8px 10px 14px}
  .erow .note{grid-area:n}.erow .pj{grid-area:p;min-width:0}.erow .range{grid-area:r;text-align:left}.erow .dur{grid-area:d}.erow .acts{grid-area:a;align-self:end}
  .entrybar{padding:12px}.entrybar .eb-note{flex-basis:100%}.eb-project{max-width:none;flex:1 1 auto}
  .eb-project,.eb-manual,.eb-timer{border-left:none;padding-left:0}
}
`;

export const ENTRY_JS = `
(function(){
  var bar=document.querySelector('[data-entrybar]');
  if(bar){
    var mode='timer';try{mode=localStorage.getItem('tt-mode')||'timer'}catch(e){}
    function setMode(m){bar.setAttribute('data-current',m);bar.querySelectorAll('[data-set-mode]').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-set-mode')===m)});
      bar.querySelectorAll('[data-mode=manual] input').forEach(function(i){if(i.name==='date')i.required=(m==='manual')});
      try{localStorage.setItem('tt-mode',m)}catch(e){}}
    bar.querySelectorAll('[data-set-mode]').forEach(function(b){b.addEventListener('click',function(){setMode(b.getAttribute('data-set-mode'))})});
    setMode(mode);
    bar.addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target.tagName==='INPUT'&&bar.getAttribute('data-current')==='timer'){e.preventDefault();bar.querySelector('[formaction]').click()}});
  }
  document.querySelectorAll('[data-project]').forEach(function(sel){
    var dot=sel.parentNode.querySelector('[data-dot]');
    function upd(){var o=sel.options[sel.selectedIndex];if(dot&&o)dot.style.background=o.getAttribute('data-color')}
    sel.addEventListener('change',upd);upd();
  });
  document.querySelectorAll('form').forEach(function(f){
    var s=f.querySelector('[data-start]'),e=f.querySelector('[data-end]'),d=f.querySelector('[data-dur]');
    if(!s||!e||!d)return;
    function calc(){if(!s.value||!e.value)return;var a=s.value.split(':'),b=e.value.split(':');var m=(+b[0]*60+ +b[1])-(+a[0]*60+ +a[1]);
      if(m>0){d.value=Math.floor(m/60)+':'+String(m%60).padStart(2,'0')}else{d.value=''}}
    s.addEventListener('change',calc);e.addEventListener('change',calc);s.addEventListener('input',calc);e.addEventListener('input',calc);
    d.addEventListener('input',function(){if(d.value){s.value='';e.value=''}});
  });
})();`;

function EntryRow(props: { e: TimeEntry; tz: string; showUser: boolean; canEdit: boolean; back: string }) {
  const { e, tz, showUser, canEdit, back } = props;
  return (
    <div class="erow">
      <div class="note">
        {e.note ? e.note : <span class="muted">(bez opisu)</span>}
        {showUser ? <div class="who">{e.user_login}</div> : null}
      </div>
      <div class="pj"><ProjectTag id={e.project_id} name={e.project_name} color={e.project_color} /></div>
      <div class="range">
        {e.started_at && e.ended_at ? `${localTime(Date.parse(e.started_at), tz)} – ${localTime(Date.parse(e.ended_at), tz)}` : "—"}
      </div>
      <div class="dur">{formatDuration(e.duration_sec)}</div>
      <div class="acts">
        {canEdit ? (
          <>
            <form method="post" action="/timer/start">
              <input type="hidden" name="project" value={e.project_id} />
              <input type="hidden" name="note" value={e.note} />
              <input type="hidden" name="back" value={back} />
              <button class="icon" type="submit" title="Kontynuuj (start timera)">{icon("play")}</button>
            </form>
            <a class="icon" href={`/entries/${e.id}/edit?back=${encodeURIComponent(back)}`} title="Edytuj">{icon("edit")}</a>
            <form method="post" action={`/entries/${e.id}/delete`} onsubmit="return confirm('Usunąć ten wpis?')">
              <input type="hidden" name="back" value={back} />
              <button class="icon del" type="submit" title="Usuń">{icon("trash")}</button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}

function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  }
  return [...map.entries()];
}

const sum = (es: TimeEntry[]) => es.reduce((s, e) => s + e.duration_sec, 0);

function DayCards(props: { entries: TimeEntry[]; tz: string; today: string; showUser: boolean; canEdit: (e: TimeEntry) => boolean; back: string }) {
  return (
    <>
      {groupBy(props.entries, (e) => e.entry_date).map(([date, es]) => (
        <div class="card day">
          <div class="day-head">
            <span>{dayLabel(date, props.today)}</span>
            <span>Razem: <span class="dur">{formatDuration(sum(es))}</span></span>
          </div>
          {es.map((e) => <EntryRow e={e} tz={props.tz} showUser={props.showUser} canEdit={props.canEdit(e)} back={props.back} />)}
        </div>
      ))}
    </>
  );
}

/** Wpisy pogrupowane: tydzień → dzień (strona główna, widok projektu). */
export function WeekGroups(props: { entries: TimeEntry[]; tz: string; today: string; showUser: boolean; canEdit: (e: TimeEntry) => boolean; back: string }) {
  const { entries, today } = props;
  if (entries.length === 0) {
    return <div class="card empty"><b>Brak wpisów</b>Dodaj pierwszy wpis w pasku powyżej.</div>;
  }
  const thisWeek = weekRange(today, 0).from;
  const lastWeek = weekRange(today, -1).from;
  return (
    <>
      {groupBy(entries, (e) => weekRange(e.entry_date).from).map(([from, es]) => {
        const r = weekRange(from);
        const label = from === thisWeek ? "Ten tydzień" : from === lastWeek ? "Poprzedni tydzień" : rangeLabel(r.from, r.to) + (from.slice(0, 4) !== today.slice(0, 4) ? ` ${from.slice(0, 4)}` : "");
        return (
          <>
            <div class="week-head"><b>{label}</b><span>Suma tygodnia: <b>{formatDuration(sum(es))}</b></span></div>
            <DayCards {...props} entries={es} />
          </>
        );
      })}
    </>
  );
}

/** Wpisy pogrupowane tylko po dniach (raporty). */
export function DayGroups(props: { entries: TimeEntry[]; tz: string; today: string; showUser: boolean; canEdit: (e: TimeEntry) => boolean; back: string }) {
  if (props.entries.length === 0) return <div class="card empty"><b>Brak wpisów w tym okresie</b>Zmień zakres dat albo filtry.</div>;
  return <DayCards {...props} />;
}
