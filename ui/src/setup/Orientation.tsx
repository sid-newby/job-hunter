import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Step,
  StepButton,
  Stepper,
  Typography,
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, ArrowForward as ArrowForwardIcon, Check as CheckIcon } from '@mui/icons-material';
import { errMsg, getJSON } from '../api';
import { SetupStatus } from '../types';
import { TEAL } from './common';
import ModelStep from './ModelStep';
import DatabaseStep from './DatabaseStep';
import AboutYouStep from './AboutYouStep';
import ProfileStep from './ProfileStep';

const STEPS = [
  { label: 'Model & keys', blurb: 'Choose the LLM that powers discovery, scoring, and tailoring, and add your Tavily search key.' },
  { label: 'Database', blurb: 'Connect a local PostgreSQL database to track every posting you find.' },
  { label: 'About you', blurb: 'Share your resume and other artifacts, then tell us, in your own words, what you want next.' },
  { label: 'Your profile', blurb: 'The model drafts your profile from everything you shared. Review it, edit anything, then finish.' },
];

function firstIncomplete(s: SetupStatus | null): number {
  if (!s || s.complete) return 0;
  if (!s.llm?.configured || !s.tavily?.key_set) return 0;
  if (!s.db?.ok || !s.db?.initialized) return 1;
  if (!s.uploads?.length && (s.interview_chars ?? 0) < 200) return 2;
  return 3;
}

function missing(s: SetupStatus): string[] {
  const out: string[] = [];
  if (!s.llm?.configured) out.push('LLM provider is not configured');
  if (!s.tavily?.key_set) out.push('Tavily API key is missing');
  if (!s.db?.ok) out.push('Database is not reachable');
  else if (!s.db.initialized) out.push('Database tables are not initialized');
  if (!s.profile?.exists) out.push('Profile has not been saved');
  return out;
}

export default function Orientation({ status, onDone, onExit }: {
  status: SetupStatus | null;
  onDone: (status: SetupStatus) => void;
  onExit?: () => void;
}) {
  const [active, setActive] = useState(() => firstIncomplete(status));
  const [ready, setReady] = useState<boolean[]>(STEPS.map(() => false));
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);

  const readySetters = useMemo(
    () => STEPS.map((_, i) => (r: boolean) => setReady((prev) => (prev[i] === r ? prev : prev.map((v, j) => (j === i ? r : v))))),
    [],
  );

  const last = active === STEPS.length - 1;

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    setGaps([]);
    try {
      const s = await getJSON<SetupStatus>('/api/setup/status');
      if (s.complete) onDone(s);
      else setGaps(missing(s));
    } catch (err) {
      setFinishError(errMsg(err));
    } finally {
      setFinishing(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
      <Paper elevation={0} sx={{ py: 2.5, px: 4, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#0E131F' }}>
        <Container maxWidth="lg" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h5" sx={{ color: 'primary.light', fontWeight: 800 }}>
              JOB HUNTER <span style={{ color: '#9CA3AF', fontWeight: 400 }}>// ORIENTATION</span>
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              A few minutes of setup, then the radar hunts for roles that fit you.
            </Typography>
          </Box>
          {onExit && (
            <Button variant="outlined" onClick={onExit} sx={{ borderColor: 'divider', color: 'text.primary' }}>
              Back to dashboard
            </Button>
          )}
        </Container>
      </Paper>

      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Stepper
          nonLinear
          activeStep={active}
          alternativeLabel
          sx={{
            mb: 4,
            '& .MuiStepIcon-root.Mui-active, & .MuiStepIcon-root.Mui-completed': { color: TEAL },
          }}
        >
          {STEPS.map((s, i) => (
            <Step key={s.label} completed={ready[i] && i !== active}>
              <StepButton onClick={() => setActive(i)} disabled={i > active && !ready.slice(0, i).every(Boolean)}>
                {s.label}
              </StepButton>
            </Step>
          ))}
        </Stepper>

        <Typography variant="h6" sx={{ fontWeight: 700 }}>{STEPS[active].label}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>{STEPS[active].blurb}</Typography>

        <Box sx={{ display: active === 0 ? 'block' : 'none' }}><ModelStep onReadyChange={readySetters[0]} /></Box>
        <Box sx={{ display: active === 1 ? 'block' : 'none' }}><DatabaseStep onReadyChange={readySetters[1]} /></Box>
        <Box sx={{ display: active === 2 ? 'block' : 'none' }}><AboutYouStep onReadyChange={readySetters[2]} active={active === 2} /></Box>
        <Box sx={{ display: active === 3 ? 'block' : 'none' }}><ProfileStep onReadyChange={readySetters[3]} /></Box>

        {last && gaps.length > 0 && (
          <Alert severity="warning" sx={{ mt: 3 }}>
            Setup isn't complete yet:
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {gaps.map((g) => <li key={g}>{g}</li>)}
            </Box>
          </Alert>
        )}
        {last && finishError && <Alert severity="error" sx={{ mt: 3 }}>{finishError}</Alert>}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4, pt: 2.5, borderTop: '1px solid #1F2937' }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => setActive((a) => a - 1)} disabled={active === 0} sx={{ color: 'text.secondary' }}>
            Back
          </Button>
          {last ? (
            <Button
              variant="contained"
              size="large"
              startIcon={finishing ? <CircularProgress size={18} color="inherit" /> : <CheckIcon />}
              onClick={finish}
              disabled={!ready[active] || finishing}
              sx={{ fontWeight: 700 }}
            >
              Finish
            </Button>
          ) : (
            <Button variant="contained" size="large" endIcon={<ArrowForwardIcon />} onClick={() => setActive((a) => a + 1)} disabled={!ready[active]} sx={{ fontWeight: 700 }}>
              Next
            </Button>
          )}
        </Box>
      </Container>
    </Box>
  );
}
