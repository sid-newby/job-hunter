import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  LinearProgress,
  Link,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  Save as SaveIcon,
  Bolt as BoltIcon,
  TravelExplore as TravelExploreIcon,
  RestartAlt as RestartAltIcon,
} from '@mui/icons-material';
import { errMsg, getJSON, postJSON } from '../api';
import {
  LlmCheck,
  ModelOverrides,
  OpenRouterModel,
  Provider,
  Role,
  ROLES,
  Settings,
  SettingsUpdate,
  TavilyCheck,
} from '../types';
import { MONO, SectionTitle, TEAL, fieldSx, panelSx } from './common';

export const PROVIDER_LABEL: Record<Provider, string> = { openrouter: 'OpenRouter', 'claude-code': 'Claude Code' };

const ROLE_INFO: Record<Role, { label: string; hint: string }> = {
  discovery: { label: 'Discovery', hint: 'Agentic web search for postings; needs tool use.' },
  qualify: { label: 'Qualify', hint: 'Scores every posting against your profile; high volume.' },
  tailor: { label: 'Tailor', hint: 'Writes tailored resumes; use your strongest writer.' },
  orient: { label: 'Orient', hint: 'Drafts your profile from uploads and notes.' },
};

type Drafts = Record<Provider, Record<Role, string>>;

const rolesFrom = (src?: Partial<Record<Role, string>>): Record<Role, string> =>
  Object.fromEntries(ROLES.map((r) => [r, src?.[r] ?? ''])) as Record<Role, string>;

let modelsPromise: Promise<OpenRouterModel[]> | null = null;
const loadModels = () => {
  modelsPromise ??= getJSON<OpenRouterModel[]>('/api/openrouter/models').catch((err) => {
    modelsPromise = null;
    throw err;
  });
  return modelsPromise;
};

const baseId = (id: string) => id.replace(/:batch$/, '');
const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.1 ? 3 : 2)}`;

function priceLine(m: OpenRouterModel, batch: boolean): string {
  const f = batch ? 0.5 : 1;
  return `${usd(m.prompt_per_m * f)} in / ${usd(m.completion_per_m * f)} out per 1M${batch ? ' (batch)' : ''}`;
}

function describe(m: OpenRouterModel, batch: boolean): string {
  const caps = [m.tools && 'tools', m.structured && 'structured', m.batch && 'batch'].filter(Boolean).join(', ');
  return `${priceLine(m, batch)} · ${Math.round(m.context_length / 1000)}k ctx${caps ? ` · ${caps}` : ''}`;
}

const capChipSx = { height: 18, fontSize: 10, bgcolor: 'rgba(20, 184, 166, 0.15)', color: '#2DD4BF' };

function ModelPicker({ role, value, onChange, models, byId, placeholder }: {
  role: Role;
  value: string;
  onChange: (v: string) => void;
  models: OpenRouterModel[];
  byId: Map<string, OpenRouterModel>;
  placeholder?: string;
}) {
  const options = useMemo(() => {
    const ids = models.map((m) => m.id);
    if (role !== 'qualify') return ids;
    return [...ids, ...models.filter((m) => m.batch).map((m) => `${m.id}:batch`)].sort();
  }, [models, role]);
  const isBatch = value.endsWith(':batch');
  const wrongBatch = isBatch && role !== 'qualify';
  const info = byId.get(baseId(value));

  return (
    <Autocomplete<string, false, false, true>
      freeSolo
      options={options}
      value={value}
      inputValue={value}
      onInputChange={(_, v) => onChange(v)}
      onChange={(_, v) => onChange(v ?? '')}
      filterOptions={(opts, { inputValue }) => {
        const q = inputValue.trim().toLowerCase();
        const hits = q
          ? opts.filter((id) => id.toLowerCase().includes(q) || (byId.get(baseId(id))?.name ?? '').toLowerCase().includes(q))
          : opts;
        return hits.slice(0, 150);
      }}
      renderOption={(props, id) => {
        const { key, ...rest } = props;
        const m = byId.get(baseId(id));
        const batch = id.endsWith(':batch');
        return (
          <li key={key} {...rest}>
            <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {m?.name ?? id}{batch ? ' · batch' : ''}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: MONO }}>{id}</Typography>
              {m && (
                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Typography variant="caption" sx={{ color: '#FBBF24', mr: 0.5 }}>{priceLine(m, batch)}</Typography>
                  {m.tools && <Chip label="tools" size="small" sx={capChipSx} />}
                  {m.structured && <Chip label="structured" size="small" sx={capChipSx} />}
                  {m.batch && <Chip label="batch" size="small" sx={capChipSx} />}
                </Box>
              )}
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label={ROLE_INFO[role].label}
          placeholder={placeholder}
          error={wrongBatch}
          helperText={
            wrongBatch
              ? 'Batch models only suit qualify; this role needs an interactive model.'
              : info
                ? describe(info, isBatch)
                : ROLE_INFO[role].hint
          }
          sx={fieldSx}
        />
      )}
    />
  );
}

export default function ModelStep({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>('openrouter');
  const [orKey, setOrKey] = useState('');
  const [tavilyKey, setTavilyKey] = useState('');
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [llmCheck, setLlmCheck] = useState<LlmCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [skipTest, setSkipTest] = useState(false);
  const [tavChecking, setTavChecking] = useState(false);
  const [tavCheck, setTavCheck] = useState<TavilyCheck | null>(null);
  const [tavError, setTavError] = useState<string | null>(null);

  const applySettings = (s: Settings) => {
    setSettings(s);
    setProvider(s.provider ?? 'openrouter');
    setDrafts({ openrouter: rolesFrom(s.models?.openrouter), 'claude-code': rolesFrom(s.models?.['claude-code']) });
    setOrKey('');
    setTavilyKey('');
    setDirty(false);
  };

  const load = async () => {
    setLoadError(null);
    try {
      applySettings(await getJSON<Settings>('/api/settings'));
    } catch (err) {
      setLoadError(errMsg(err));
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (provider !== 'openrouter' || models.length) return;
    setModelsLoading(true);
    setModelsError(null);
    loadModels()
      .then(setModels)
      .catch((err) => setModelsError(errMsg(err)))
      .finally(() => setModelsLoading(false));
  }, [provider]);

  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  const keysOk = !!settings && settings.tavily_key_set && (settings.provider === 'claude-code' || settings.openrouter_key_set);
  const ready = keysOk && !dirty && (!!llmCheck?.ok || skipTest);
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  const buildUpdate = (): SettingsUpdate => {
    const u: SettingsUpdate = {};
    if (!settings || !drafts) return u;
    if (provider !== settings.provider) u.provider = provider;
    if (orKey.trim()) u.openrouter_api_key = orKey.trim();
    if (tavilyKey.trim()) u.tavily_api_key = tavilyKey.trim();
    const changedModels: NonNullable<SettingsUpdate['models']> = {};
    (Object.keys(drafts) as Provider[]).forEach((p) => {
      const changed: ModelOverrides = {};
      ROLES.forEach((r) => {
        const v = drafts[p][r].trim();
        if (v !== (settings.models?.[p]?.[r] ?? '')) changed[r] = v;
      });
      if (Object.keys(changed).length) changedModels[p] = changed;
    });
    if (Object.keys(changedModels).length) u.models = changedModels;
    return u;
  };

  const save = async (): Promise<boolean> => {
    const u = buildUpdate();
    if (!Object.keys(u).length) {
      setDirty(false);
      return true;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const s = await postJSON<Settings>('/api/settings', u);
      if (u.provider || u.openrouter_api_key || u.models) {
        setLlmCheck(null);
        setSkipTest(false);
      }
      if (u.tavily_api_key) setTavCheck(null);
      applySettings(s);
      return true;
    } catch (err) {
      setSaveError(errMsg(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const resetModels = async () => {
    const blank: ModelOverrides = { default: '' };
    ROLES.forEach((r) => (blank[r] = ''));
    setSaveError(null);
    try {
      const s = await postJSON<Settings>('/api/settings', { models: { [provider]: blank } });
      setSettings(s);
      setDrafts((d) => (d ? { ...d, [provider]: rolesFrom(s.models?.[provider]) } : d));
      setLlmCheck(null);
    } catch (err) {
      setSaveError(errMsg(err));
    }
  };

  const testLlm = async () => {
    setCheckError(null);
    setLlmCheck(null);
    if (dirty && !(await save())) return;
    setChecking(true);
    try {
      setLlmCheck(await postJSON<LlmCheck>('/api/setup/check-llm'));
    } catch (err) {
      setCheckError(errMsg(err));
    } finally {
      setChecking(false);
    }
  };

  const testTavily = async () => {
    setTavError(null);
    setTavCheck(null);
    if (dirty && !(await save())) return;
    setTavChecking(true);
    try {
      setTavCheck(await postJSON<TavilyCheck>('/api/setup/check-tavily'));
    } catch (err) {
      setTavError(errMsg(err));
    } finally {
      setTavChecking(false);
    }
  };

  const setDraft = (role: Role, v: string) => {
    setDrafts((d) => (d ? { ...d, [provider]: { ...d[provider], [role]: v } } : d));
    setDirty(true);
  };

  if (loadError) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
        Couldn't load settings: {loadError}
      </Alert>
    );
  }
  if (!settings || !drafts) {
    return <Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Box>;
  }

  const defaults = rolesFrom(settings.defaults?.[provider]);
  const wizard = Boolean(onReadyChange);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Paper elevation={0} sx={panelSx}>
        <SectionTitle hint="Which LLM runs discovery, qualification, tailoring, and your profile draft.">LLM provider</SectionTitle>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={provider}
          onChange={(_, v: Provider | null) => {
            if (v) {
              setProvider(v);
              setDirty(true);
            }
          }}
          sx={{ mb: 2.5, '& .Mui-selected': { color: `${TEAL} !important`, bgcolor: 'rgba(20, 184, 166, 0.12) !important' } }}
        >
          <ToggleButton value="openrouter" sx={{ px: 3 }}>OpenRouter (API key)</ToggleButton>
          <ToggleButton value="claude-code" sx={{ px: 3 }}>Claude Code (local login)</ToggleButton>
        </ToggleButtonGroup>

        {provider === 'openrouter' ? (
          <>
            <TextField
              fullWidth
              size="small"
              type="password"
              autoComplete="off"
              label="OpenRouter API key"
              placeholder={settings.openrouter_key_set ? 'Leave blank to keep the saved key' : 'sk-or-...'}
              value={orKey}
              onChange={(e) => {
                setOrKey(e.target.value);
                setDirty(true);
              }}
              helperText={settings.openrouter_key_set ? `saved: ${settings.openrouter_key_hint}. Leave blank to keep it.` : 'Create one at openrouter.ai/keys.'}
              sx={{ ...fieldSx, mb: 2.5 }}
            />
            <SectionTitle hint="Models ending in :batch run on OpenRouter's async Batch API (up to 24h, half price) and only suit qualify. Discovery, tailor, and orient need an interactive model.">
              Models per role
            </SectionTitle>
            {modelsLoading && <LinearProgress sx={{ mb: 2 }} />}
            {modelsError && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Couldn't load the OpenRouter model list ({modelsError}). You can still type a model id.
              </Alert>
            )}
            <Grid container spacing={2}>
              {ROLES.map((r) => (
                <Grid item xs={12} md={6} key={r}>
                  <ModelPicker role={r} value={drafts.openrouter[r]} onChange={(v) => setDraft(r, v)} models={models} byId={byId} placeholder={defaults[r]} />
                </Grid>
              ))}
            </Grid>
          </>
        ) : (
          <>
            <Alert severity="info" sx={{ mb: 2.5 }}>
              Uses the local Claude Code login on this machine, so no API key is needed. If you haven't signed in yet, run <code>claude</code> in a terminal first.
            </Alert>
            <SectionTitle hint="Leave a field blank to use the default shown as its placeholder.">Models per role</SectionTitle>
            <Grid container spacing={2}>
              {ROLES.map((r) => (
                <Grid item xs={12} md={6} key={r}>
                  <TextField
                    fullWidth
                    size="small"
                    label={ROLE_INFO[r].label}
                    placeholder={defaults[r]}
                    value={drafts['claude-code'][r]}
                    onChange={(e) => setDraft(r, e.target.value)}
                    helperText={ROLE_INFO[r].hint}
                    sx={fieldSx}
                  />
                </Grid>
              ))}
            </Grid>
          </>
        )}
        <Button size="small" startIcon={<RestartAltIcon />} onClick={resetModels} sx={{ mt: 1.5, color: 'text.secondary' }}>
          Reset {PROVIDER_LABEL[provider]} models to defaults
        </Button>
      </Paper>

      <Paper elevation={0} sx={panelSx}>
        <SectionTitle hint="Discovery searches the web through Tavily. Required.">Tavily search</SectionTitle>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            type="password"
            autoComplete="off"
            label="Tavily API key"
            placeholder={settings.tavily_key_set ? 'Leave blank to keep the saved key' : 'tvly-...'}
            value={tavilyKey}
            onChange={(e) => {
              setTavilyKey(e.target.value);
              setDirty(true);
            }}
            helperText={settings.tavily_key_set ? `saved: ${settings.tavily_key_hint}. Leave blank to keep it.` : 'Get a key at tavily.com.'}
            sx={{ ...fieldSx, flex: 1, minWidth: 280 }}
          />
          <Button
            variant="outlined"
            startIcon={tavChecking ? <CircularProgress size={16} /> : <TravelExploreIcon />}
            onClick={testTavily}
            disabled={tavChecking || saving || (!settings.tavily_key_set && !tavilyKey.trim())}
            sx={{ mt: 0.25 }}
          >
            Test Tavily (1 credit)
          </Button>
        </Box>
        {tavCheck && (
          <Alert severity={tavCheck.ok ? 'success' : 'error'} sx={{ mt: 1.5 }}>
            {tavCheck.ok ? `Tavily is working (${tavCheck.results ?? 0} results).` : tavCheck.error || 'Tavily check failed.'}
          </Alert>
        )}
        {tavError && <Alert severity="error" sx={{ mt: 1.5 }}>{tavError}</Alert>}
      </Paper>

      {saveError && <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{saveError}</Alert>}

      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />} onClick={save} disabled={saving || !dirty}>
          Save
        </Button>
        <Button variant="outlined" startIcon={checking ? <CircularProgress size={16} /> : <BoltIcon />} onClick={testLlm} disabled={checking || saving}>
          Test connection
        </Button>
        <Chip
          size="small"
          label={dirty ? 'Unsaved changes' : 'Saved'}
          sx={{ bgcolor: dirty ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)', color: dirty ? '#FBBF24' : '#34D399' }}
        />
        {wizard && keysOk && !dirty && !llmCheck?.ok && !skipTest && !checking && (
          <Link component="button" type="button" variant="body2" onClick={() => setSkipTest(true)} sx={{ color: 'text.secondary' }}>
            Skip test
          </Link>
        )}
      </Box>

      {wizard && !keysOk && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Save {settings.provider === 'openrouter' && !settings.openrouter_key_set ? 'an OpenRouter key and ' : ''}a Tavily key to continue.
        </Typography>
      )}

      {checking && (
        <Alert severity="info" icon={<CircularProgress size={18} />}>
          Testing the {PROVIDER_LABEL[provider]} connection. This can take up to two minutes.
        </Alert>
      )}
      {checkError && <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{checkError}</Alert>}
      {llmCheck && (
        <Alert severity={llmCheck.ok ? (llmCheck.problems?.length ? 'warning' : 'success') : 'error'} sx={{ whiteSpace: 'pre-wrap' }}>
          {llmCheck.ok
            ? `Connected via ${PROVIDER_LABEL[llmCheck.provider] ?? llmCheck.provider}${llmCheck.model ? ` (${llmCheck.model})` : ''}.${llmCheck.reply ? ` Reply: "${llmCheck.reply}"` : ''}`
            : llmCheck.error || 'Connection test failed.'}
          {llmCheck.problems && llmCheck.problems.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
              {llmCheck.problems.map((p, i) => <li key={i}>{p}</li>)}
            </Box>
          )}
          {llmCheck.models && (
            <Typography variant="caption" component="div" sx={{ mt: 1, fontFamily: MONO, opacity: 0.8 }}>
              {ROLES.map((r) => `${r}: ${llmCheck.models[r] ?? '-'}`).join('  ·  ')}
            </Typography>
          )}
        </Alert>
      )}
    </Box>
  );
}
