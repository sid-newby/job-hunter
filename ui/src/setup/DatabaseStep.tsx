import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Grid, Paper, TextField, Typography } from '@mui/material';
import { Storage as StorageIcon } from '@mui/icons-material';
import { errMsg, getJSON, postJSON } from '../api';
import { DbStatus, Settings, SettingsUpdate, SetupStatus } from '../types';
import { MONO, SectionTitle, fieldSx, panelSx } from './common';

interface DbForm {
  host: string;
  port: string;
  dbname: string;
  user: string;
  password: string;
}

const INSTALL_HINT = 'brew install postgresql@18 && brew services start postgresql@18';

export default function DatabaseStep({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }) {
  const [form, setForm] = useState<DbForm>({ host: 'localhost', port: '5432', dbname: 'job_hunter', user: '', password: '' });
  const [passwordSet, setPasswordSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const [settings, setup] = await Promise.allSettled([
      getJSON<Settings>('/api/settings'),
      getJSON<SetupStatus>('/api/setup/status'),
    ]);
    if (settings.status === 'fulfilled' && settings.value?.db) {
      const db = settings.value.db;
      setForm({ host: db.host || 'localhost', port: String(db.port || '5432'), dbname: db.dbname || 'job_hunter', user: db.user || '', password: '' });
      setPasswordSet(Boolean(db.password_set));
    } else if (settings.status === 'rejected') {
      setLoadError(errMsg(settings.reason));
    }
    if (setup.status === 'fulfilled' && setup.value?.db) setStatus(setup.value.db);
    setDirty(false);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const ready = !!status?.ok && !!status.initialized && !dirty;
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  const set = (k: keyof DbForm, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const saveAndCreate = async () => {
    setBusy(true);
    setError(null);
    setAttempted(true);
    try {
      const db: NonNullable<SettingsUpdate['db']> = { host: form.host.trim(), port: form.port.trim(), dbname: form.dbname.trim(), user: form.user.trim() };
      if (form.password) db.password = form.password;
      const s = await postJSON<Settings>('/api/settings', { db });
      setPasswordSet(Boolean(s?.db?.password_set));
      setForm((f) => ({ ...f, password: '' }));
      setDirty(false);
      setStatus(await postJSON<DbStatus>('/api/setup/db'));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Box>;

  const failed = status && !status.ok;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {loadError && (
        <Alert severity="warning" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
          Couldn't load saved database settings ({loadError}). Showing defaults.
        </Alert>
      )}
      <Paper elevation={0} sx={panelSx}>
        <SectionTitle hint="A local PostgreSQL database holds every posting, score, and status. Saving creates the database and tables if they don't exist.">
          PostgreSQL connection
        </SectionTitle>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={8}>
            <TextField fullWidth size="small" label="Host" value={form.host} onChange={(e) => set('host', e.target.value)} sx={fieldSx} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="Port" value={form.port} onChange={(e) => set('port', e.target.value)} sx={fieldSx} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="Database name" value={form.dbname} onChange={(e) => set('dbname', e.target.value)} sx={fieldSx} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="User" value={form.user} onChange={(e) => set('user', e.target.value)} sx={fieldSx} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              type="password"
              autoComplete="off"
              label="Password (optional)"
              placeholder={passwordSet ? 'Leave blank to keep' : ''}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              helperText={passwordSet ? 'A password is saved.' : 'Local installs usually need none.'}
              sx={fieldSx}
            />
          </Grid>
        </Grid>
        <Button
          variant="contained"
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <StorageIcon />}
          onClick={saveAndCreate}
          disabled={busy || !form.host.trim() || !form.dbname.trim()}
          sx={{ mt: 2.5 }}
        >
          Save & create database
        </Button>
      </Paper>

      {error && <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{error}</Alert>}

      {status?.ok && (
        <Alert severity={status.initialized ? 'success' : 'warning'}>
          Connected to <b>{status.dbname}</b> on {status.host}:{status.port} as {status.user || 'default user'}
          {status.created ? ' (database created)' : ''}.{' '}
          {status.initialized
            ? `Tables ready${status.opportunities != null ? ` · ${status.opportunities.toLocaleString()} opportunities` : ''}.`
            : 'Tables are not initialized yet; click "Save & create database".'}
          {dirty && ' You have unsaved changes above.'}
        </Alert>
      )}

      {(failed || error) && !busy && (
        <Alert severity={failed && attempted ? 'error' : 'info'} sx={{ whiteSpace: 'pre-wrap' }}>
          {failed && <Box sx={{ mb: 1 }}>{attempted ? '' : 'Not connected yet: '}{status?.error || 'Could not connect to PostgreSQL.'}</Box>}
          <Typography variant="body2" component="div">
            Install PostgreSQL:{' '}
            <Box component="code" sx={{ fontFamily: MONO, fontSize: 12, bgcolor: '#0B0F19', px: 0.75, py: 0.25, borderRadius: 0.5 }}>{INSTALL_HINT}</Box>
          </Typography>
        </Alert>
      )}
    </Box>
  );
}
