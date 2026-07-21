import fs from 'fs';
import path from 'path';

const srcFile = 'ray-triangulation-demo.html';
const destFile = 'live-measurement-ux-demo.html';

let content = fs.readFileSync(srcFile, 'utf8');

// Title
content = content.replace('<title>Ray Triangulation Demo</title>', '<title>Live Measurement UX Demo</title>');
content = content.replace('<h1>Ray Triangulation Core — Interactive Demo</h1>', '<h1>Live Measurement UX & Coaching Demo</h1>');

// Sidebar sections
const newSidebarSections = `
      <div class="section">
        <div class="section-title">Draft Status</div>
        <div class="metric">
          <div class="metric-value" id="draft-status" style="color:var(--accent); text-transform: uppercase;">IDLE</div>
        </div>
        <div class="metric" style="margin-top: 10px;">
          <div class="metric-label">Coaching Prompt</div>
          <div class="metric-value" id="coaching-prompt" style="color:var(--warn); font-size: 14px;">NONE</div>
        </div>
        <div class="metric" style="margin-top: 10px;">
          <div class="metric-label">Quality Score</div>
          <div class="metric-value" id="quality-score">0.00</div>
          <div class="metric-bar">
            <div class="metric-bar-fill" id="score-bar" style="width:0%;background:var(--accent)"></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Solved Point (metres)</div>
`;
content = content.replace('<div class="section">\n        <div class="section-title">Solved Point (metres)</div>', newSidebarSections);

// Buttons
const newControls = `
      <div class="controls">
        <button class="btn primary" id="btn-confirm" onclick="dispatchAction('confirmRequested')" disabled>Confirm Point</button>
        <button class="btn" onclick="dispatchAction('retargetDraft')">Retarget</button>
        <button class="btn" onclick="dispatchAction('cancelDraft')">Cancel Draft</button>
        <button class="btn" onclick="undoLast()">Undo last ray</button>
        <button class="btn" onclick="clearAll()">Clear all (Reset)</button>
        <label style="display:flex;align-items:center;gap:8px;margin-top:12px;">
`;
content = content.replace('<div class="controls">\n        <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">', newControls);
// Remove loadPreset
content = content.replace('<button class="btn primary" onclick="loadPreset()">Load preset scene</button>', '');

// Imports
const newImports = `
    import { solveClosestPointOfApproach } from './src/utils/ray-triangulation-core.ts';
    import { sampleDepthPrior } from './src/utils/depth-prior-provider.ts';
    import { reduceLiveMeasurementDraft, computeLateralBaselineM } from './src/utils/live-measurement-quality.ts';

    const thresholds = {
      thresholdProfileId: 'demo_profile',
      thresholdVersion: 1,
      minInliers: 2,
      minBaselineM: 2.0,
      targetUncertainty: 0.2,
      maxUncertaintyHard: 1.0,
      maxRmsError: 0.1,
      maxObservationAgeMs: 9999999, // disable time checks for manual demo
      maxPoseDepthSkewMs: 9999999,
      readyEnterScore: 0.8,
      readyExitScore: 0.6,
    };

    let draftState = {
      status: 'idle',
      prompt: 'none',
      canConfirm: false,
      lastQualityScore: 0,
      thresholdProfileId: 'demo_profile',
      thresholdVersion: 1
    };

    window.dispatchAction = function(type) {
      if (type === 'cancelDraft' || type === 'retargetDraft') {
         rays = [];
         result = null;
      }
      
      const inputs = buildInputs();
      draftState = reduceLiveMeasurementDraft(draftState, inputs, thresholds, { type });
      updateSidebar();
      draw();

      if (type === 'confirmRequested') {
         setTimeout(() => {
            dispatchAction(Math.random() > 0.2 ? 'confirmSucceeded' : 'confirmFailed');
         }, 800);
      }
    };

    window.undoLast = function() {
      if (rays.length > 0) {
         rays.pop();
         solve('removeLastRay');
      }
    };
    
    function buildInputs() {
      const hasSolvedPoint = result != null && result.point != null;
      
      let baselineM = 0;
      if (rays.length >= 2) {
         const meanDir = { x: 0, y: 0, z: 0 };
         for (const r of rays) {
            meanDir.x += r.dir.x; meanDir.y += r.dir.y; meanDir.z += r.dir.z;
         }
         baselineM = computeLateralBaselineM(rays.map(r => r.origin), meanDir);
      }

      return {
        uncertainty: result && result.uncertainty != null ? result.uncertainty : null,
        rmsError: result && result.rmsError != null ? result.rmsError : null,
        baselineM,
        rayCount: rays.length,
        inlierCount: result ? (result.inlierCount || rays.length) : rays.length,
        hasSolvedPoint,
        solverDegenerate: false,
        observationAgeMs: 0,
        poseDepthTimeSkewMs: 0,
      };
    }
`;
content = content.replace(/import \{ solveClosestPointOfApproach.*?;/s, newImports);

// solve function
const oldSolve = `    function solve() {
      const obs = rays.map(r => ({
        ray: { origin: r.origin, direction: r.dir },
        rayWeight: r.weight,
        // Passing depth points if they are attached to the ray (e.g. from priorObs)
        depthPoint: r.priorObs ? { x: r.priorObs.point[0], y: r.priorObs.point[1], z: r.priorObs.point[2] } : undefined,
        depthWeight: r.priorObs ? r.priorObs.weight : undefined
      }));
      result = solveClosestPointOfApproach(obs);
      updateSidebar();
      draw();
    }`;

const newSolve = `    function solve(eventType = 'observationAdded') {
      if (rays.length === 0) {
         result = null;
      } else {
        const obs = rays.map(r => ({
          ray: { origin: r.origin, direction: r.dir },
          rayWeight: r.weight,
          depthPoint: r.priorObs ? { x: r.priorObs.point[0], y: r.priorObs.point[1], z: r.priorObs.point[2] } : undefined,
          depthWeight: r.priorObs ? r.priorObs.weight : undefined
        }));
        result = solveClosestPointOfApproach(obs);
      }
      
      const inputs = buildInputs();
      draftState = reduceLiveMeasurementDraft(draftState, inputs, thresholds, { type: eventType });
      updateSidebar();
      draw();
    }`;
content = content.replace(oldSolve, newSolve);

// updateSidebar function modifications
const newUpdateSidebar = `
    function updateSidebar() {
      // Live Measurement specific updates
      document.getElementById('draft-status').textContent = draftState.status;
      
      const promptCol = draftState.prompt === 'ready_to_confirm' ? 'var(--good)' : 
                       (draftState.prompt === 'none' ? 'var(--muted)' : 'var(--warn)');
      document.getElementById('coaching-prompt').textContent = draftState.prompt.replace(/_/g, ' ').toUpperCase();
      document.getElementById('coaching-prompt').style.color = promptCol;
      
      document.getElementById('quality-score').textContent = draftState.lastQualityScore.toFixed(2);
      document.getElementById('score-bar').style.width = \`\${draftState.lastQualityScore * 100}%\`;
      
      const btnConfirm = document.getElementById('btn-confirm');
      btnConfirm.disabled = !draftState.canConfirm;
      if (draftState.status === 'confirm_pending') {
          btnConfirm.textContent = 'Confirming...';
      } else if (draftState.status === 'confirm_failed') {
          btnConfirm.textContent = 'Retry Confirm (Failed)';
          btnConfirm.style.background = 'var(--bad)';
      } else if (draftState.status === 'confirmed') {
          btnConfirm.textContent = 'Confirmed!';
          btnConfirm.style.background = 'var(--good)';
      } else {
          btnConfirm.textContent = 'Confirm Point';
          btnConfirm.style.background = '';
      }

      const R = result;
      document.getElementById('px').textContent = R ? fmt(R.point.x) : '—';
      document.getElementById('py').textContent = R ? fmt(R.point.y) : '—';
      document.getElementById('pz').textContent = R ? fmt(R.point.z) : '—';

      if (R) {
        const rCol = R.rmsError < 0.05 ? 'var(--good)' : R.rmsError < 0.5 ? 'var(--warn)' : 'var(--bad)';
        const uCol = R.uncertainty < 1 ? 'var(--good)' : R.uncertainty < 2 ? 'var(--warn)' : 'var(--bad)';
        document.getElementById('rms').textContent = fmt(R.rmsError, 3) + ' m'; document.getElementById('rms').style.color = rCol;
        document.getElementById('rms-bar').style.cssText = \`width:\${Math.min(100, R.rmsError * 100)}%;background:\${rCol}\`;
        document.getElementById('unc').textContent = fmt(R.uncertainty, 2); document.getElementById('unc').style.color = uCol;
        document.getElementById('unc-bar').style.cssText = \`width:\${Math.min(100, R.uncertainty * 20)}%;background:\${uCol}\`;
        
        document.getElementById('coaching').style.display = 'none'; // Replaced by our coaching prompt widget
        const dot = document.getElementById('sdot'), txt = document.getElementById('status-text');
        
        if (draftState.status === 'ready') { dot.style.background = 'var(--good)'; txt.textContent = 'Ready'; }
        else if (draftState.status === 'confirmed') { dot.style.background = 'var(--good)'; txt.textContent = 'Confirmed'; }
        else { dot.style.background = 'var(--accent)'; txt.textContent = draftState.status; }
      } else {
        ['rms', 'unc'].forEach(id => { document.getElementById(id).textContent = '—'; });
        document.getElementById('rms-bar').style.width = '0%';
        document.getElementById('unc-bar').style.width = '0%';
        document.getElementById('coaching').style.display = 'none';
        document.getElementById('sdot').style.background = 'var(--muted)';
        document.getElementById('status-text').textContent = rays.length ? 'Singular' : 'No rays';
      }
      updateRayList();
    }
`;
// Replace the original updateSidebar with our new one
content = content.replace(/function updateSidebar\(\) \{[\s\S]*?updateRayList\(\);\n    \}/, newUpdateSidebar.trim());

// clearAll should also dispatch cancelDraft
content = content.replace("window.clearAll = () => { rays = []; result = null; updateSidebar(); draw(); };", "window.clearAll = () => { dispatchAction('cancelDraft'); };");

fs.writeFileSync(destFile, content);
console.log('Successfully generated', destFile);
