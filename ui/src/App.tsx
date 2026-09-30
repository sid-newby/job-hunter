import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  TextField,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  IconButton,
  Tooltip,
  Paper,
  Divider,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Alert,
  FormControlLabel,
  Switch,
  Collapse,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  OpenInNew as OpenInNewIcon,
  Description as DescriptionIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  RocketLaunch as RocketIcon,
  AttachMoney as MoneyIcon,
  HomeWork as HomeWorkIcon,
  LocationOn as LocationIcon,
  InfoOutlined as InfoIcon,
  Close as CloseIcon,
  PictureAsPdf as PictureAsPdfIcon,
  AutoFixHigh as AutoFixHighIcon,
  Send as SendIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { Opportunity, Stats, CostTelemetry, Meta, SetupStatus, ROLES } from './types';
import { errMsg, getJSON, pollJob, postJSON } from './api';
import Orientation from './setup/Orientation';
import SettingsDialog from './setup/SettingsDialog';
import { PROVIDER_LABEL } from './setup/ModelStep';
import { ChipsInput } from './setup/common';

interface CompanyOption {
  company: string;
  count: number;
}

interface SectorOption {
  sector: string;
  count: number;
}

const buildMetroOptions = (meta: Meta | null): { value: string; label: string }[] => [
  { value: 'targets', label: '🎯 All target metros' },
  ...(meta?.metros ?? [])
    .filter((m) => !['targets', 'remote', 'all'].includes(m.key))
    .map((m) => ({ value: m.key, label: `📍 ${m.label}` })),
  { value: 'remote', label: '🏠 Remote' },
  { value: 'all', label: '🌐 Anywhere (no location filter)' },
];

function Dashboard({ onRerunOrientation }: { onRerunOrientation: () => void }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [sectors, setSectors] = useState<SectorOption[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, filed: 0, review: 0, declined: 0, applied: 0, weak: 0, avg_score: 0 });
  const [loading, setLoading] = useState<boolean>(true);
  
  // Filtering & Sorting State
  const [search, setSearch] = useState<string>('');
  const [searchDraft, setSearchDraft] = useState<string>('');
  const [statusTab, setStatusTab] = useState<string>('filed');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [metro, setMetro] = useState<string>('targets');
  const [hasCompOnly, setHasCompOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<string>('score_desc');
  const [showLegend, setShowLegend] = useState<boolean>(true);

  // Dialog states
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);

  // Tailor Strategy Studio states
  const [tailorModalOpen, setTailorModalOpen] = useState<boolean>(false);
  const [tailoringOpp, setTailoringOpp] = useState<Opportunity | null>(null);
  const [tailorIntel, setTailorIntel] = useState<string>('');
  const [tailorHighlights, setTailorHighlights] = useState<string[]>([]);
  const [tailorPositioning, setTailorPositioning] = useState<string>('');
  const [tailorRevisionFeedback, setTailorRevisionFeedback] = useState<string>('');
  const [tailorOutput, setTailorOutput] = useState<{ resume: string; rationale: string } | null>(null);
  const [tailoringLoading, setTailoringLoading] = useState<boolean>(false);
  const [tailorLog, setTailorLog] = useState<string[]>([]);
  const [tailorError, setTailorError] = useState<string | null>(null);

  // Cost Telemetry state
  const [costModalOpen, setCostModalOpen] = useState<boolean>(false);
  const [costData, setCostData] = useState<CostTelemetry | null>(null);
  const [costLoading, setCostLoading] = useState<boolean>(false);

  // Scout Swarm state
  const [scoutModalOpen, setScoutModalOpen] = useState<boolean>(false);
  const [scoutScope, setScoutScope] = useState<string>('all');
  const [scoutCustomQuery, setScoutCustomQuery] = useState<string>('');
  const [scoutRunning, setScoutRunning] = useState<boolean>(false);
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [scoutResults, setScoutResults] = useState<any[] | null>(null);
  const [scoutLog, setScoutLog] = useState<string[]>([]);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const fetchMeta = async () => {
    try {
      setMeta(await getJSON<Meta>('/api/meta'));
      setMetaError(null);
    } catch (err) {
      setMetaError(errMsg(err));
    }
  };

  useEffect(() => {
    fetchMeta();
  }, []);

  const metroOptions = buildMetroOptions(meta);
  const metroLabel = (value: string): string => metroOptions.find((m) => m.value === value)?.label ?? value;
  const scopeLabels: Record<string, string> = Object.fromEntries((meta?.scopes ?? []).map((sc) => [sc.key, sc.label]));
  const sectorLabel = (sector: string | null): string => {
    if (!sector || sector === 'untracked') return 'Untracked (pre-scope runs)';
    if (sector === 'all') return 'All scopes';
    return scopeLabels[sector] ?? sector;
  };
  const providerLine = meta
    ? `${PROVIDER_LABEL[meta.provider] ?? meta.provider}${meta.models?.tailor ? ` · tailor: ${meta.models.tailor}` : ''}`
    : '';

  const fetchCosts = async () => {
    setCostLoading(true);
    try {
      const res = await fetch('/api/costs');
      if (res.ok) {
        const data = await res.json();
        setCostData(data);
      }
    } catch (err) {
      console.error('Error fetching costs:', err);
    } finally {
      setCostLoading(false);
    }
  };

  const fetchOpportunities = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusTab !== 'all') params.append('status', statusTab);
      if (selectedCompany !== 'all') params.append('company', selectedCompany);
      if (selectedSector !== 'all') params.append('sector', selectedSector);
      if (metro !== 'all') params.append('metro', metro);
      if (hasCompOnly) params.append('has_comp', 'true');
      params.append('sort_by', sortBy);

      const res = await fetch(`/api/opportunities?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setOpportunities(data);
      }
      
      const statsParams = new URLSearchParams();
      if (selectedSector !== 'all') statsParams.append('sector', selectedSector);
      const statsRes = await fetch(`/api/stats?${statsParams.toString()}`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      const compRes = await fetch('/api/companies');
      if (compRes.ok) {
        const compData = await compRes.json();
        setCompanies(compData);
      }

      const sectorRes = await fetch('/api/sectors');
      if (sectorRes.ok) {
        const sectorData = await sectorRes.json();
        setSectors(sectorData);
      }
    } catch (err) {
      console.error('Error fetching opportunities:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOpportunities();
    fetchCosts();
  }, [statusTab, selectedCompany, selectedSector, metro, hasCompOnly, sortBy]);

  const handleStatusUpdate = async (id: number, newStatus: string) => {
    try {
      const res = await fetch(`/api/opportunities/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        fetchOpportunities();
      }
    } catch (err) {
      console.error('Status update failed:', err);
    }
  };

  const handleOpenTailorStudio = (opp: Opportunity) => {
    setTailoringOpp(opp);
    setTailorOutput(null);
    setTailorRevisionFeedback('');
    setTailorIntel('');
    setTailorHighlights([]);
    setTailorPositioning(meta?.positioning ?? '');

    setTailorModalOpen(true);
  };

  const startJob = async (url: string, body: unknown): Promise<string> => {
    const data = await postJSON<{ job_id?: string }>(url, body);
    if (!data?.job_id) throw new Error('Server did not return a job id. Restart the backend (task dev).');
    return data.job_id;
  };

  const runTailorJob = async (body: any) => {
    setTailoringLoading(true);
    setTailorError(null);
    setTailorLog([]);
    try {
      const jobId = await startJob(`/api/opportunities/${tailoringOpp!.id}/tailor`, body);
      const job = await pollJob<any>(jobId, setTailorLog);
      if (job.status === 'done' && job.result?.resume) {
        setTailorOutput({ resume: job.result.resume, rationale: job.result.rationale });
        return true;
      }
      setTailorError((job.error || 'Tailor run failed without a message.').slice(-2500));
      if (job.result?.rejected_resume) {
        setTailorOutput({ resume: job.result.rejected_resume, rationale: 'Lint rejected this draft; see the error above. Nothing was shipped.' });
      }
    } catch (err) {
      console.error('Tailoring failed:', err);
      setTailorError(errMsg(err));
    } finally {
      setTailoringLoading(false);
    }
    return false;
  };

  const handleExecuteTailor = async () => {
    if (!tailoringOpp) return;
    await runTailorJob({ intel: tailorIntel, highlights: tailorHighlights, positioning: tailorPositioning });
  };

  const handleExecuteRevision = async () => {
    if (!tailoringOpp || !tailorRevisionFeedback.trim()) return;
    const ok = await runTailorJob({ revise: tailorRevisionFeedback });
    if (ok) setTailorRevisionFeedback('');
  };

  const handleRunScout = async () => {
    setScoutRunning(true);
    setScoutResults(null);
    setScoutError(null);
    setScoutLog([]);
    try {
      const jobId = await startJob('/api/scout', {
        scope: scoutScope,
        custom_query: scoutCustomQuery ? scoutCustomQuery : null,
      });
      const job = await pollJob<any>(jobId, setScoutLog);
      if (job.status === 'done' && job.result) {
        setScoutResults(job.result.opportunities || []);
        setSelectedSector(scoutScope);
        setStatusTab('all');
        setMetro('targets');
        fetchOpportunities();
      } else {
        setScoutError((job.error || 'Scout run failed without a message.').slice(-2500));
      }
    } catch (err) {
      console.error('Scout execution failed:', err);
      setScoutError(errMsg(err));
    } finally {
      setScoutRunning(false);
    }
  };

  const filtered = opportunities.filter((opp) => {
    const q = search.toLowerCase();
    return (
      opp.title.toLowerCase().includes(q) ||
      opp.company.toLowerCase().includes(q) ||
      opp.archetype.toLowerCase().includes(q) ||
      (opp.sector && (opp.sector.toLowerCase().includes(q) || sectorLabel(opp.sector).toLowerCase().includes(q))) ||
      (opp.summary && opp.summary.toLowerCase().includes(q))
    );
  });

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
      {/* Top Header */}
      <Paper
        elevation={0}
        sx={{
          py: 2.5,
          px: 4,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: '#0E131F',
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="h5" sx={{ color: 'primary.light', fontWeight: 800 }}>
                JOB HUNTER
                {meta?.candidate_name && <span style={{ color: '#9CA3AF', fontWeight: 400 }}> // {meta.candidate_name}</span>}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                {providerLine || (metaError ? 'Configuration unavailable' : 'Loading configuration...')} · PostgreSQL
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
              <Button
                variant="outlined"
                startIcon={<MoneyIcon sx={{ color: '#14b8a6' }} />}
                onClick={() => {
                  setCostModalOpen(true);
                  fetchCosts();
                }}
                sx={{
                  borderColor: 'rgba(20, 184, 166, 0.4)',
                  color: '#14b8a6',
                  bgcolor: 'rgba(20, 184, 166, 0.08)',
                  fontWeight: 700,
                  textTransform: 'none',
                  '&:hover': {
                    borderColor: '#14b8a6',
                    bgcolor: 'rgba(20, 184, 166, 0.16)',
                  }
                }}
              >
                <Box component="span" sx={{ display: 'flex', gap: 1.25, alignItems: 'baseline' }}>
                  <span>LLM {costData ? ((costData.llm_total_tokens ?? 0) / 1000).toFixed(0) : '0'}k tok</span>
                  <Box component="span" sx={{ color: 'rgba(20, 184, 166, 0.5)' }}>·</Box>
                  <span>Tavily ${costData ? (costData.tavily_total_usd ?? 0).toFixed(2) : '0.00'}</span>
                </Box>
              </Button>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={() => {
                  fetchOpportunities();
                  fetchCosts();
                }}
                sx={{ borderColor: 'divider', color: 'text.primary' }}
              >
                Refresh
              </Button>
              <Button
                variant="contained"
                color="primary"
                startIcon={<RocketIcon />}
                onClick={() => {
                  setScoutResults(null);
                  setScoutModalOpen(true);
                }}
                sx={{ fontWeight: 700 }}
              >
                Hunt Opportunities
              </Button>
              <Tooltip title="Settings">
                <IconButton onClick={() => setSettingsOpen(true)} sx={{ color: 'text.secondary', border: '1px solid', borderColor: 'divider' }}>
                  <SettingsIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Pipeline Stats Tiles */}
          <Grid container spacing={2} sx={{ mt: 1.5 }}>
            <Grid item xs={6} sm={2.4}>
              <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: '#111827', border: '1px solid #1F2937' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>TOTAL TRACKED</Typography>
                <Typography variant="h6" sx={{ color: 'text.primary' }}>{stats.total}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} sm={2.4}>
              <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: '#111827', border: '1px solid #1F2937' }}>
                <Typography variant="caption" sx={{ color: '#3B82F6', fontWeight: 700 }}>FILED (≥70 FIT)</Typography>
                <Typography variant="h6" sx={{ color: '#3B82F6', fontWeight: 700 }}>{stats.filed}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} sm={2.4}>
              <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: '#111827', border: '1px solid #1F2937' }}>
                <Typography variant="caption" sx={{ color: '#F59E0B' }}>IN REVIEW (50-69)</Typography>
                <Typography variant="h6" sx={{ color: '#F59E0B' }}>{stats.review}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} sm={2.4}>
              <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: '#111827', border: '1px solid #1F2937' }}>
                <Typography variant="caption" sx={{ color: '#EF4444' }}>DECLINED · WEAK</Typography>
                <Typography variant="h6" sx={{ color: '#EF4444' }}>{stats.declined} <Typography component="span" sx={{ color: '#9CA3AF' }}>· {stats.weak}</Typography></Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} sm={2.4}>
              <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: '#111827', border: '1px solid #1F2937' }}>
                <Typography variant="caption" sx={{ color: '#10B981' }}>APPLIED</Typography>
                <Typography variant="h6" sx={{ color: '#10B981' }}>{stats.applied}</Typography>
              </Paper>
            </Grid>
          </Grid>
        </Container>
      </Paper>

      {/* Main Content Area */}
      <Container maxWidth="xl" sx={{ mt: 3 }}>
        {metaError && (
          <Alert severity="warning" sx={{ mb: 3 }} action={<Button color="inherit" size="small" onClick={fetchMeta}>Retry</Button>}>
            Couldn't load profile metadata ({metaError}). Metro and scope filters may be incomplete.
          </Alert>
        )}
        {/* Pipeline Stage Explanation Legend */}
        <Collapse in={showLegend}>
          <Paper sx={{ p: 2, mb: 3, bgcolor: '#111827', border: '1px solid #1F2937', position: 'relative' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <InfoIcon fontSize="small" sx={{ color: 'primary.light' }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                  Pipeline Stages & Calibration Guide
                </Typography>
              </Box>
              <IconButton size="small" onClick={() => setShowLegend(false)} sx={{ color: 'text.secondary' }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={12} sm={6} md={3}>
                <Typography variant="caption" sx={{ color: '#3B82F6', fontWeight: 700, display: 'block' }}>
                  🎯 Filed (≥70):
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  High-alignment roles that match your profile's bullseye criteria. Ready for 1-click tailored resume generation.
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Typography variant="caption" sx={{ color: '#F59E0B', fontWeight: 700, display: 'block' }}>
                  🔍 In Review (50–69):
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Borderline or operational stretch roles (adjacent domain or non-standard title). Kept here for inspection so you can promote or decline.
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Typography variant="caption" sx={{ color: '#EF4444', fontWeight: 700, display: 'block' }}>
                  🚫 Declined:
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Roles you explicitly passed on. Permanently indexed in PostgreSQL so future scout runs never waste tokens re-scraping them.
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Typography variant="caption" sx={{ color: '#10B981', fontWeight: 700, display: 'block' }}>
                  ✅ Applied:
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Positions where you have submitted an application or reached out to the hiring team.
                </Typography>
              </Grid>
            </Grid>
          </Paper>
        </Collapse>

        {/* Filters Toolbar */}
        <Paper sx={{ p: 2, mb: 3, bgcolor: '#0E131F', border: '1px solid #1F2937' }}>
          <Grid container spacing={2} alignItems="center">
            {/* Status Tabs */}
            <Grid item xs={12} lg={4}>
              <Tabs
                value={statusTab}
                onChange={(_, val) => setStatusTab(val)}
                textColor="primary"
                indicatorColor="primary"
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab label={`Filed (${stats.filed})`} value="filed" />
                <Tab label={`In Review (${stats.review})`} value="review" />
                <Tab label={`Weak Fit (${stats.weak})`} value="weak" />
                <Tab label={`Applied (${stats.applied})`} value="applied" />
                <Tab label={`Declined (${stats.declined})`} value="declined" />
                <Tab label={`All (${stats.total})`} value="all" />
              </Tabs>
            </Grid>

            {/* Company Dropdown */}
            <Grid item xs={12} sm={6} md={3} lg={2.5}>
              <FormControl fullWidth size="small">
                <InputLabel id="company-filter-label">Filter by Company</InputLabel>
                <Select
                  labelId="company-filter-label"
                  value={selectedCompany}
                  label="Filter by Company"
                  onChange={(e) => setSelectedCompany(e.target.value)}
                  sx={{ bgcolor: '#111827' }}
                >
                  <MenuItem value="all">🏢 All Companies ({stats.total})</MenuItem>
                  {companies.map((c) => (
                    <MenuItem key={c.company} value={c.company}>
                      {c.company} ({c.count})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Sector Dropdown */}
            <Grid item xs={12} sm={6} md={3} lg={2.5}>
              <FormControl fullWidth size="small">
                <InputLabel id="sector-filter-label">Filter by Scope</InputLabel>
                <Select
                  labelId="sector-filter-label"
                  value={selectedSector}
                  label="Filter by Scope"
                  onChange={(e) => {
                    const newSector = e.target.value;
                    setSelectedSector(newSector);
                    if (newSector !== 'all') {
                      setStatusTab('all');
                    }
                  }}
                  sx={{ bgcolor: '#111827' }}
                >
                  <MenuItem value="all">🎯 All Scopes ({stats.total})</MenuItem>
                  {sectors.map((s) => (
                    <MenuItem key={s.sector} value={s.sector}>
                      {sectorLabel(s.sector)} ({s.count})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Sort Order */}
            <Grid item xs={12} sm={6} md={3} lg={2}>
              <FormControl fullWidth size="small">
                <InputLabel id="sort-filter-label">Sort By</InputLabel>
                <Select
                  labelId="sort-filter-label"
                  value={sortBy}
                  label="Sort By"
                  onChange={(e) => setSortBy(e.target.value)}
                  sx={{ bgcolor: '#111827' }}
                >
                  <MenuItem value="score_desc">⭐ Best Match (Score)</MenuItem>
                  <MenuItem value="comp_desc">💰 Highest Listed Pay</MenuItem>
                  <MenuItem value="company_asc">🏢 Company (A-Z)</MenuItem>
                  <MenuItem value="newest">🕒 Newest Discovered</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {/* Metro Filter & Search */}
            <Grid item xs={12} md={6} lg={3.5}>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <FormControl size="small" sx={{ minWidth: 210 }}>
                  <InputLabel id="metro-filter-label">Metro</InputLabel>
                  <Select
                    labelId="metro-filter-label"
                    value={metro}
                    label="Metro"
                    onChange={(e) => setMetro(e.target.value)}
                    startAdornment={<LocationIcon sx={{ fontSize: 16, mr: 0.5, color: metro !== 'all' ? 'primary.main' : 'text.secondary' }} />}
                  >
                    {metroOptions.map((m) => (
                      <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField
                  fullWidth
                  size="small"
                  placeholder="Keyword search (press Enter)..."
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSearch(searchDraft.trim());
                    if (e.key === 'Escape') { setSearchDraft(''); setSearch(''); }
                  }}
                  onBlur={() => { if (searchDraft.trim() === '') setSearch(''); }}
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} fontSize="small" />,
                  }}
                  sx={{ bgcolor: '#111827', borderRadius: 1 }}
                />
              </Box>
            </Grid>
          </Grid>
        </Paper>

        {/* Opportunity Cards Grid */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
            <CircularProgress />
          </Box>
        ) : filtered.length === 0 ? (
          <Paper sx={{ p: 6, textAlign: 'center', bgcolor: '#111827', border: '1px dashed #374151' }}>
            <Typography variant="body1" sx={{ color: 'text.secondary' }}>
              No opportunities found matching this filter criteria.
            </Typography>
            <Box sx={{ mt: 2, display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
              {metro !== 'all' && (
                <Button variant="outlined" size="small" onClick={() => setMetro('all')}>
                  Clear '{metroLabel(metro)}' Filter
                </Button>
              )}
              {statusTab !== 'all' && (
                <Button variant="outlined" size="small" onClick={() => setStatusTab('all')}>
                  View All Stages ({stats.total} total)
                </Button>
              )}
              {selectedSector !== 'all' && (
                <Button variant="text" size="small" onClick={() => setSelectedSector('all')}>
                  Clear Scope Filter
                </Button>
              )}
            </Box>
          </Paper>
        ) : (
          <Grid container spacing={2.5}>
            {filtered.map((opp) => (
              <Grid item xs={12} md={6} lg={4} key={opp.id}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                  <CardContent sx={{ flexGrow: 1, pb: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                        {opp.company}
                      </Typography>
                      <Chip
                        label={`${opp.score}/100`}
                        size="small"
                        sx={{
                          bgcolor: opp.score >= 85 ? 'rgba(37, 99, 235, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: opp.score >= 85 ? '#60A5FA' : '#FBBF24',
                          border: `1px solid ${opp.score >= 85 ? '#2563EB' : '#D97706'}`,
                          fontWeight: 700,
                        }}
                      />
                    </Box>

                    <Typography variant="h6" sx={{ color: 'text.primary', mb: 1.5, lineHeight: 1.3 }}>
                      {opp.title}
                    </Typography>

                    {/* Metadata Pills */}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                      <Chip
                        label={opp.archetype}
                        size="small"
                        sx={{ bgcolor: '#1F2937', color: '#D1D5DB', fontSize: '0.72rem' }}
                      />
                      {opp.sector && (
                        <Chip
                          label={sectorLabel(opp.sector)}
                          size="small"
                          sx={{ bgcolor: 'rgba(20, 184, 166, 0.15)', color: '#2DD4BF', fontSize: '0.72rem', fontWeight: 600 }}
                        />
                      )}
                      {opp.location && opp.location !== 'Not specified' && !(opp.work_arrangement || '').includes(opp.location) && (
                        <Chip
                          icon={<LocationIcon sx={{ fontSize: '0.85rem !important' }} />}
                          label={opp.location}
                          size="small"
                          sx={{ bgcolor: '#1F2937', color: '#9CA3AF', fontSize: '0.72rem' }}
                        />
                      )}
                      {opp.work_arrangement && opp.work_arrangement !== 'Not specified' && (
                        <Chip
                          icon={<HomeWorkIcon sx={{ fontSize: '0.85rem !important' }} />}
                          label={opp.work_arrangement}
                          size="small"
                          sx={{
                            bgcolor: opp.work_arrangement.toLowerCase().includes('remote') ? 'rgba(16, 185, 129, 0.15)' : '#1F2937',
                            color: opp.work_arrangement.toLowerCase().includes('remote') ? '#34D399' : '#9CA3AF',
                            fontSize: '0.72rem'
                          }}
                        />
                      )}
                      {opp.compensation && opp.compensation !== 'Not listed' && opp.compensation !== 'Not specified' && (
                        <Chip
                          icon={<MoneyIcon sx={{ fontSize: '0.85rem !important' }} />}
                          label={opp.compensation}
                          size="small"
                          sx={{ bgcolor: 'rgba(245, 158, 11, 0.15)', color: '#FBBF24', fontSize: '0.72rem', fontWeight: 700 }}
                        />
                      )}
                    </Box>

                    {opp.summary && (
                      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.85rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {opp.summary}
                      </Typography>
                    )}
                  </CardContent>

                  <Divider sx={{ borderColor: 'divider' }} />

                  <CardActions sx={{ px: 2, py: 1.5, justifyContent: 'space-between' }}>
                    <Box>
                      <Button
                        size="small"
                        variant="outlined"
                        color="primary"
                        startIcon={<DescriptionIcon />}
                        onClick={() => setSelectedOpp(opp)}
                        sx={{ mr: 1 }}
                      >
                        Details
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        color="primary"
                        startIcon={<AutoFixHighIcon />}
                        onClick={() => handleOpenTailorStudio(opp)}
                      >
                        Tailor
                      </Button>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Tooltip title="Download tailored resume PDF">
                        <IconButton size="small" href={`/api/opportunities/${opp.id}/pdf`} target="_blank" sx={{ color: '#14B8A6', mr: 0.5 }}>
                          <PictureAsPdfIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {opp.url && (
                        <Tooltip title="Open Original Posting">
                          <IconButton size="small" href={opp.url} target="_blank" sx={{ color: 'text.secondary' }}>
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {opp.status !== 'declined' && (
                        <Tooltip title="Decline Opportunity">
                          <IconButton
                            size="small"
                            onClick={() => handleStatusUpdate(opp.id, 'declined')}
                            sx={{ color: '#EF4444' }}
                          >
                            <BlockIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {opp.status !== 'applied' && (
                        <Tooltip title="Mark Applied">
                          <IconButton
                            size="small"
                            onClick={() => handleStatusUpdate(opp.id, 'applied')}
                            sx={{ color: '#10B981' }}
                          >
                            <CheckCircleIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Container>

      {/* Tailor Strategy Studio Modal */}
      <Dialog
        open={tailorModalOpen}
        onClose={() => {
          if (!tailoringLoading) setTailorModalOpen(false);
        }}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#111827', border: '1px solid #1F2937' } }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid #1F2937' }}>
          <Typography component="div" variant="h6" sx={{ color: 'primary.light', fontWeight: 800 }}>
            🎯 Tailor Strategy Studio — {tailoringOpp?.company}
          </Typography>
          <Typography component="div" variant="subtitle2" sx={{ color: 'text.secondary' }}>
            {tailoringOpp?.title} · Score: {tailoringOpp?.score}/100 · {tailoringOpp?.work_arrangement}
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ mt: 2 }}>
          {tailorError && (
            <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>
              {tailorError}
            </Alert>
          )}
          {tailoringLoading ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <CircularProgress size={52} />
              <Typography variant="h6" sx={{ mt: 3, color: 'text.primary' }}>
                Drafting and linting with {meta?.models?.tailor ?? 'the tailor model'}...
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                Facts, skills index, recommendations, and company intel go in verbatim. Two to four minutes is normal.
              </Typography>
              <Box component="pre" sx={{ mt: 3, mx: 'auto', maxWidth: 820, maxHeight: 220, overflow: 'auto', textAlign: 'left', fontSize: 11, color: '#9CA3AF', bgcolor: '#0B0F19', p: 1.5, borderRadius: 1, border: '1px solid #1F2937' }}>
                {tailorLog.slice(-25).join('\n') || 'Starting...'}
              </Box>
            </Box>
          ) : tailorOutput ? (
            <Box>
              {/* Output Preview & Revision */}
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle1" sx={{ color: 'primary.light', fontWeight: 700, mb: 1 }}>
                    Tailored Resume (Markdown Preview)
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: '#0B0F19', maxHeight: 450, overflow: 'auto', border: '1px solid #1F2937' }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                      {tailorOutput.resume}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle1" sx={{ color: 'secondary.light', fontWeight: 700, mb: 1 }}>
                    Rationale & Strategic Framing Sidecar
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: '#0B0F19', maxHeight: 450, overflow: 'auto', border: '1px solid #1F2937' }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                      {tailorOutput.rationale}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>

              {/* Interactive Revision Studio */}
              <Paper sx={{ p: 2.5, mt: 3, bgcolor: '#0E131F', border: '1px solid #2563EB' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.light', mb: 1 }}>
                  💬 Interactive Revision Prompt
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
                  Want to sharpen a bullet, emphasize a different achievement, or adjust the tone? Enter your direction below and the model will revise the draft and re-compile the PDF.
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="e.g. 'Lead with the platform migration bullet' or 'Tone down the management phrasing'..."
                    value={tailorRevisionFeedback}
                    onChange={(e) => setTailorRevisionFeedback(e.target.value)}
                    sx={{ bgcolor: '#111827' }}
                  />
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<SendIcon />}
                    onClick={handleExecuteRevision}
                    disabled={!tailorRevisionFeedback.trim()}
                    sx={{ whiteSpace: 'nowrap', px: 3 }}
                  >
                    Revise
                  </Button>
                </Box>
              </Paper>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Insider Intel Box */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.light', mb: 0.5 }}>
                  💡 Insider Intel & Strategic Direction
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                  Share your personal relationships, knowledge of their business, or specific value-add propositions you want emphasized in the resume.
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  rows={4}
                  placeholder="e.g. I know their engineering leadership from a past partnership. Emphasize the product I launched that solves the problem in their posting..."
                  value={tailorIntel}
                  onChange={(e) => setTailorIntel(e.target.value)}
                  sx={{ bgcolor: '#0B0F19' }}
                />
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
                  🛠️ Achievements & Capabilities to Foreground
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                  Optional. Name projects, products, or wins from your facts that the tailor model should prioritize.
                </Typography>
                <ChipsInput label="Highlights" value={tailorHighlights} onChange={setTailorHighlights} placeholder="Type a highlight and press Enter" />
              </Box>

              <TextField
                fullWidth
                size="small"
                label="Strategic Positioning Angle"
                value={tailorPositioning}
                onChange={(e) => setTailorPositioning(e.target.value)}
                helperText="Defaults to the positioning in your profile. Rewrite it to angle this resume differently."
                sx={{ bgcolor: '#0B0F19' }}
              />
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2.5, borderTop: '1px solid #1F2937', justifyContent: 'space-between' }}>
          <Box>
            {tailorOutput && tailoringOpp && (
              <Button
                variant="contained"
                startIcon={<PictureAsPdfIcon />}
                href={`/api/opportunities/${tailoringOpp.id}/pdf`}
                target="_blank"
                sx={{ bgcolor: '#0D9488', '&:hover': { bgcolor: '#0F766E' }, fontWeight: 700 }}
              >
                Download Resume PDF
              </Button>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button
              onClick={() => {
                setTailorModalOpen(false);
                setTailorOutput(null);
              }}
              disabled={tailoringLoading}
            >
              {tailorOutput ? 'Close' : 'Cancel'}
            </Button>
            {!tailorOutput && (
              <Button
                variant="contained"
                color="primary"
                startIcon={<AutoFixHighIcon />}
                onClick={handleExecuteTailor}
                disabled={tailoringLoading}
                sx={{ fontWeight: 700 }}
              >
                Synthesize Tailored Resume & PDF
              </Button>
            )}
          </Box>
        </DialogActions>
      </Dialog>

      {/* Scout Swarm Modal */}
      <Dialog
        open={scoutModalOpen}
        onClose={() => {
          if (!scoutRunning) setScoutModalOpen(false);
        }}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#111827', border: '1px solid #1F2937' } }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid #1F2937' }}>
          <Typography component="div" variant="h6" sx={{ color: 'primary.light', fontWeight: 800 }}>
            🚀 Launch Opportunity Scout Swarm
          </Typography>
          <Typography component="div" variant="subtitle2" sx={{ color: 'text.secondary' }}>
            Sweeps your target boards, then an LLM agent with web search finds, verifies, and scores live postings. Runs take several minutes.
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          {scoutError && (
            <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>
              {scoutError}
            </Alert>
          )}
          {scoutRunning ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <CircularProgress size={48} />
              <Typography variant="h6" sx={{ mt: 3, color: 'text.primary' }}>
                Hunting & Evaluating Roles...
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                {scoutScope === 'all' ? 'Running every scope in your profile' : `Running scope: ${sectorLabel(scoutScope)}`} across your job boards and Tavily search.
              </Typography>
              <Typography variant="caption" sx={{ color: '#9CA3AF', display: 'block', mt: 1 }}>
                LLM qualification and 3-layer deduplication active.
              </Typography>
              <Box component="pre" sx={{ mt: 3, mx: 'auto', maxWidth: 820, maxHeight: 260, overflow: 'auto', textAlign: 'left', fontSize: 11, color: '#9CA3AF', bgcolor: '#0B0F19', p: 1.5, borderRadius: 1, border: '1px solid #1F2937' }}>
                {scoutLog.slice(-30).join('\n') || 'Starting...'}
              </Box>
            </Box>
          ) : scoutResults ? (
            <Box>
              <Alert severity="success" sx={{ mb: 3, bgcolor: '#064E3B', color: '#A7F3D0' }}>
                Scout swarm completed! Found and qualified {scoutResults.length} new opportunities.
              </Alert>

              <Grid container spacing={2}>
                {scoutResults.map((item, idx) => (
                  <Grid item xs={12} key={idx}>
                    <Paper sx={{ p: 2, bgcolor: '#0B0F19', border: '1px solid #1F2937' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
                          {item.title} — <span style={{ color: '#60A5FA' }}>{item.company}</span>
                        </Typography>
                        <Chip
                          label={`${item.score}/100`}
                          size="small"
                          color={item.score >= 80 ? "primary" : "secondary"}
                        />
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                        <Chip label={item.work_arrangement} size="small" sx={{ fontSize: '0.72rem' }} />
                        <Chip label={item.compensation} size="small" sx={{ fontSize: '0.72rem', color: '#FBBF24' }} />
                        <Chip label={item.archetype} size="small" sx={{ fontSize: '0.72rem' }} />
                      </Box>
                      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                        {item.summary}
                      </Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, my: 1 }}>
              <FormControl fullWidth size="small">
                <InputLabel id="scout-scope-label">Scope</InputLabel>
                <Select
                  labelId="scout-scope-label"
                  value={scoutScope}
                  label="Scope"
                  onChange={(e) => setScoutScope(e.target.value)}
                >
                  <MenuItem value="all">🌐 All scopes</MenuItem>
                  {(meta?.scopes ?? []).map((sc) => (
                    <MenuItem key={sc.key} value={sc.key}>{sc.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                fullWidth
                size="small"
                label="Custom Search Keyword / Company (Optional)"
                placeholder="e.g. https://jobs.ashbyhq.com/<company>, a company name, or a job title..."
                value={scoutCustomQuery}
                onChange={(e) => setScoutCustomQuery(e.target.value)}
                helperText="Leave blank to run the scope's saved search queries."
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: '1px solid #1F2937' }}>
          <Button onClick={() => setScoutModalOpen(false)} disabled={scoutRunning}>
            {scoutResults ? "Done" : "Cancel"}
          </Button>
          {!scoutResults && (
            <Button
              variant="contained"
              color="primary"
              onClick={handleRunScout}
              disabled={scoutRunning}
              startIcon={<RocketIcon />}
            >
              Start Scout Swarm
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Details Dialog */}
      <Dialog
        open={Boolean(selectedOpp)}
        onClose={() => setSelectedOpp(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#111827', border: '1px solid #1F2937' } }}
      >
        {selectedOpp && (
          <>
            <DialogTitle sx={{ borderBottom: '1px solid #1F2937' }}>
              <Typography component="div" variant="h6">{selectedOpp.title}</Typography>
              <Typography component="div" variant="subtitle2" sx={{ color: 'text.secondary' }}>
                {selectedOpp.company} · {selectedOpp.archetype}{selectedOpp.sector ? ` · ${sectorLabel(selectedOpp.sector)}` : ''} · Score: {selectedOpp.score}/100
              </Typography>
            </DialogTitle>
            <DialogContent sx={{ mt: 2 }}>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={6}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>LOCATION / ARRANGEMENT</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{[selectedOpp.location, selectedOpp.work_arrangement].filter((v) => v && v !== 'Not specified').join(' · ') || 'Not specified'}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>COMPENSATION</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: '#FBBF24' }}>{selectedOpp.compensation}</Typography>
                </Grid>
              </Grid>

              {selectedOpp.benefits && selectedOpp.benefits.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>PERKS & BENEFITS</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selectedOpp.benefits.map((b, idx) => (
                      <Chip key={idx} label={b} size="small" sx={{ bgcolor: '#1F2937', fontSize: '0.72rem' }} />
                    ))}
                  </Box>
                </Box>
              )}

              {selectedOpp.summary && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>EXECUTIVE FIT SUMMARY</Typography>
                  <Typography variant="body2" sx={{ color: 'text.primary' }}>{selectedOpp.summary}</Typography>
                </Box>
              )}

              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>CANONICAL URL</Typography>
              <Typography variant="body2" sx={{ mb: 2, wordBreak: 'break-all' }}>
                <a href={selectedOpp.url} target="_blank" rel="noreferrer" style={{ color: '#60A5FA' }}>
                  {selectedOpp.url}
                </a>
              </Typography>

              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>ORIGINAL POSTING SNIPPET</Typography>
              <Paper sx={{ p: 2, bgcolor: '#0B0F19', maxHeight: 250, overflow: 'auto', border: '1px solid #1F2937' }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: '#D1D5DB' }}>
                  {selectedOpp.raw_text || 'No raw text stored.'}
                </Typography>
              </Paper>
            </DialogContent>
            <DialogActions sx={{ p: 2, borderTop: '1px solid #1F2937' }}>
              <Button onClick={() => setSelectedOpp(null)}>Close</Button>
              <Button
                variant="contained"
                onClick={() => {
                  const opp = selectedOpp;
                  setSelectedOpp(null);
                  handleOpenTailorStudio(opp);
                }}
              >
                Tailor Resume
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Spend & Telemetry Modal */}
      <Dialog
        open={costModalOpen}
        onClose={() => setCostModalOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: '#0B0F19',
            border: '1px solid rgba(20, 184, 166, 0.4)',
            borderRadius: 2,
            backgroundImage: 'none',
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid #1F2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <MoneyIcon sx={{ color: '#14b8a6', fontSize: 28 }} />
            <Box>
              <Typography component="div" variant="h6" sx={{ fontWeight: 700, color: '#F9FAFB' }}>
                Cost & Telemetry Tracker
              </Typography>
              <Typography component="div" variant="caption" sx={{ color: '#9CA3AF' }}>
                PostgreSQL logging of LLM token usage and Tavily search credits
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={() => setCostModalOpen(false)} sx={{ color: '#9CA3AF' }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ py: 3 }}>
          {/* Summary Stat Cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={4}>
              <Paper sx={{ p: 2, bgcolor: '#111827', border: '1px solid #1F2937', borderRadius: 1.5 }}>
                <Typography variant="caption" sx={{ color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                  Total Aggregate Spend
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 800, color: '#14b8a6', mt: 0.5 }}>
                  ${costData ? costData.total_usd.toFixed(4) : '0.0000'}
                </Typography>
                <Typography variant="caption" sx={{ color: '#6B7280', mt: 0.5, display: 'block' }}>
                  {costData ? costData.total_events : 0} logged pipeline operations
                </Typography>
              </Paper>
            </Grid>

            <Grid item xs={12} sm={4}>
              <Paper sx={{ p: 2, bgcolor: '#111827', border: '1px solid #1F2937', borderRadius: 1.5 }}>
                <Typography variant="caption" sx={{ color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                  LLM ($)
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 800, color: '#60A5FA', mt: 0.5 }}>
                  ${costData ? (costData.llm_total_usd ?? 0).toFixed(4) : '0.0000'}
                </Typography>
                <Typography variant="caption" sx={{ color: '#6B7280', mt: 0.5, display: 'block' }}>
                  {costData ? ((costData.llm_total_tokens ?? 0) / 1000).toFixed(1) : 0}k total tokens processed
                </Typography>
                {meta && (
                  <Typography variant="caption" sx={{ color: '#9CA3AF', display: 'block' }}>
                    {PROVIDER_LABEL[meta.provider] ?? meta.provider}
                    {meta.provider === 'claude-code' ? ' (subscription usage, not billed per token)' : ''}
                  </Typography>
                )}
              </Paper>
            </Grid>

            <Grid item xs={12} sm={4}>
              <Paper sx={{ p: 2, bgcolor: '#111827', border: '1px solid #1F2937', borderRadius: 1.5 }}>
                <Typography variant="caption" sx={{ color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                  Tavily ProSearch & Web
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 800, color: '#F472B6', mt: 0.5 }}>
                  ${costData ? (costData.tavily_total_usd ?? 0).toFixed(4) : '0.0000'}
                </Typography>
                <Typography variant="caption" sx={{ color: '#6B7280', mt: 0.5, display: 'block' }}>
                  {costData ? (costData.tavily_total_credits ?? 0) : 0} credits used (~$0.008/credit)
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          {meta && (
            <Box sx={{ mb: 3, p: 1.5, bgcolor: '#111827', border: '1px solid #1F2937', borderRadius: 1.5 }}>
              <Typography variant="caption" sx={{ color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, display: 'block', mb: 0.75 }}>
                Active provider · {PROVIDER_LABEL[meta.provider] ?? meta.provider}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {ROLES.map((r) => (
                  <Chip key={r} size="small" label={`${r}: ${meta.models?.[r] ?? '-'}`} sx={{ bgcolor: '#1F2937', color: '#D1D5DB', fontFamily: 'monospace', fontSize: '0.72rem' }} />
                ))}
              </Box>
            </Box>
          )}

          {/* Daily Breakdown Table */}
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#E5E7EB', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            Daily Aggregate Spend Breakdown
          </Typography>

          <TableContainer component={Paper} sx={{ bgcolor: '#111827', border: '1px solid #1F2937', borderRadius: 1.5 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: '#0D1117' }}>
                <TableRow>
                  <TableCell sx={{ color: '#9CA3AF', fontWeight: 700, borderColor: '#1F2937' }}>Date</TableCell>
                  <TableCell align="right" sx={{ color: '#9CA3AF', fontWeight: 700, borderColor: '#1F2937' }}>LLM tokens</TableCell>
                  <TableCell align="right" sx={{ color: '#9CA3AF', fontWeight: 700, borderColor: '#1F2937' }}>LLM ($)</TableCell>
                  <TableCell align="right" sx={{ color: '#9CA3AF', fontWeight: 700, borderColor: '#1F2937' }}>Tavily Credits</TableCell>
                  <TableCell align="right" sx={{ color: '#9CA3AF', fontWeight: 700, borderColor: '#1F2937' }}>Tavily ($)</TableCell>
                  <TableCell align="right" sx={{ color: '#14b8a6', fontWeight: 700, borderColor: '#1F2937' }}>Total Spend ($)</TableCell>
                  <TableCell align="right" sx={{ color: '#9CA3AF', fontWeight: 700, borderColor: '#1F2937' }}>Events</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {costData && costData.daily && costData.daily.length > 0 ? (
                  costData.daily.map((row) => (
                    <TableRow key={row.day} sx={{ '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.02)' } }}>
                      <TableCell sx={{ color: '#F3F4F6', fontWeight: 600, borderColor: '#1F2937' }}>{row.day}</TableCell>
                      <TableCell align="right" sx={{ color: '#9CA3AF', fontFamily: 'monospace', borderColor: '#1F2937' }}>
                        {(row.llm_tokens ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ color: '#60A5FA', fontFamily: 'monospace', borderColor: '#1F2937' }}>
                        ${(row.llm_cost ?? 0).toFixed(4)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: '#9CA3AF', fontFamily: 'monospace', borderColor: '#1F2937' }}>
                        {row.tavily_credits}
                      </TableCell>
                      <TableCell align="right" sx={{ color: '#F472B6', fontFamily: 'monospace', borderColor: '#1F2937' }}>
                        ${(row.tavily_cost ?? 0).toFixed(4)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: '#14b8a6', fontWeight: 700, fontFamily: 'monospace', borderColor: '#1F2937' }}>
                        ${(row.total_cost ?? 0).toFixed(4)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: '#9CA3AF', borderColor: '#1F2937' }}>
                        {row.event_count}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ color: '#9CA3AF', py: 3, borderColor: '#1F2937' }}>
                      No telemetry recorded yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>

        <DialogActions sx={{ borderTop: '1px solid #1F2937', px: 3, py: 2 }}>
          <Button onClick={fetchCosts} startIcon={<RefreshIcon />} sx={{ color: '#9CA3AF' }}>
            Refresh Telemetry
          </Button>
          <Button onClick={() => setCostModalOpen(false)} variant="outlined" sx={{ color: '#E5E7EB', borderColor: '#374151' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          fetchMeta();
          fetchOpportunities();
        }}
        onRerunOrientation={() => {
          setSettingsOpen(false);
          onRerunOrientation();
        }}
      />
    </Box>
  );
}

export default function App() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [orienting, setOrienting] = useState<boolean>(false);
  const [bypass, setBypass] = useState<boolean>(false);

  const loadStatus = async () => {
    setStatusError(null);
    try {
      setStatus(await getJSON<SetupStatus>('/api/setup/status'));
    } catch (err) {
      setStatusError(errMsg(err));
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  if (!status && !statusError) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (statusError && !orienting && !bypass) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Paper sx={{ p: 4, maxWidth: 640, bgcolor: '#111827', border: '1px solid #1F2937' }}>
          <Typography variant="h5" sx={{ color: 'primary.light', fontWeight: 800, mb: 2 }}>JOB HUNTER</Typography>
          <Alert severity="error" sx={{ mb: 3, whiteSpace: 'pre-wrap' }}>Couldn't read setup status: {statusError}</Alert>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <Button variant="contained" startIcon={<RefreshIcon />} onClick={loadStatus}>Retry</Button>
            <Button variant="outlined" onClick={() => setOrienting(true)}>Open orientation</Button>
            <Button onClick={() => setBypass(true)} sx={{ color: 'text.secondary' }}>Open dashboard anyway</Button>
          </Box>
        </Paper>
      </Box>
    );
  }

  if (orienting || (status && !status.complete && !bypass)) {
    return (
      <Orientation
        status={status}
        onDone={(s) => {
          setStatus(s);
          setOrienting(false);
          setBypass(false);
        }}
        onExit={status?.complete || bypass ? () => setOrienting(false) : undefined}
      />
    );
  }

  return <Dashboard onRerunOrientation={() => setOrienting(true)} />;
}
