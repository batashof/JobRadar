--
-- PostgreSQL database dump
--

\restrict YK2Gt9zfuvMVtee0LmzEpIBCeKH2ePDtAxolkAczPQF30gV1ItmdDy4UqBtmKNo

-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: sources; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sources (id, slug, kind, config, is_active, last_run_at, last_run_status) FROM stdin;
4aff69f9-b7cc-4ffe-b8d0-b8135372a8b8	hh	api	{"baseUrl": "https://api.hh.ru", "endpoint": "/vacancies"}	f	\N	\N
584d1505-dafc-4f09-9001-1d5fd7fd3e5e	telegram	telegram	{"channels": ["job_react", "geekjobs", "remote_it_jobs", "rabotafrontend", "golang_jobs", "qa_jobs", "FreeVacanciesIT"], "messagesPerChannel": 50}	t	\N	\N
9541c55f-fca5-4208-b843-34f6f02d2b99	remoteok	api	{"feedUrl": "https://remoteok.com/api", "linkBackRequired": true}	f	\N	\N
294e766e-1a1a-4ce8-8f80-a8fa8a56141b	weworkremotely	rss	{"feedUrls": ["https://weworkremotely.com/categories/remote-programming-jobs.rss", "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss", "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss", "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss", "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss"]}	t	\N	\N
fa0e14ec-1681-43af-9d04-44ad424eaa33	remotive	api	{"feedUrl": "https://remotive.com/api/remote-jobs?category=software-dev", "linkBackRequired": true}	t	\N	\N
0d6bbf09-4930-4194-b688-85b4b5bf25a4	jobicy	api	{"feedUrls": ["https://jobicy.com/api/v2/remote-jobs?industry=dev&count=50", "https://jobicy.com/api/v2/remote-jobs?industry=data-science&count=50", "https://jobicy.com/api/v2/remote-jobs?industry=cybersecurity&count=50", "https://jobicy.com/api/v2/remote-jobs?industry=qa-testing&count=50"], "linkBackRequired": true}	t	\N	\N
0dbd72aa-7f9b-4920-9c05-243cf6abef1b	hn	api	{"threads": 2, "apiBaseUrl": "https://hn.algolia.com/api/v1"}	t	\N	\N
291d7398-95d6-4fad-86ab-a0981a59b878	ats	api	{"companies": [{"ats": "greenhouse", "name": "GitLab", "token": "gitlab"}, {"ats": "greenhouse", "name": "Grafana Labs", "token": "grafanalabs"}, {"ats": "greenhouse", "name": "Mozilla", "token": "mozilla"}, {"ats": "greenhouse", "name": "Twilio", "token": "twilio"}, {"ats": "greenhouse", "name": "Reddit", "token": "reddit"}, {"ats": "greenhouse", "name": "Affirm", "token": "affirm"}, {"ats": "greenhouse", "name": "Samsara", "token": "samsara"}, {"ats": "greenhouse", "name": "Coinbase", "token": "coinbase"}, {"ats": "greenhouse", "name": "Pinterest", "token": "pinterest"}, {"ats": "greenhouse", "name": "Instacart", "token": "instacart"}, {"ats": "greenhouse", "name": "Databricks", "token": "databricks"}, {"ats": "greenhouse", "name": "Temporal", "token": "temporaltechnologies"}, {"ats": "greenhouse", "name": "Tailscale", "token": "tailscale"}, {"ats": "greenhouse", "name": "Cloudflare", "token": "cloudflare"}, {"ats": "greenhouse", "name": "Fivetran", "token": "fivetran"}, {"ats": "greenhouse", "name": "Stripe", "token": "stripe"}, {"ats": "greenhouse", "name": "Datadog", "token": "datadog"}, {"ats": "greenhouse", "name": "Webflow", "token": "webflow"}, {"ats": "greenhouse", "name": "Dropbox", "token": "dropbox"}, {"ats": "greenhouse", "name": "Remote.com", "token": "remotecom"}, {"ats": "greenhouse", "name": "Airtable", "token": "airtable"}, {"ats": "greenhouse", "name": "Vercel", "token": "vercel"}, {"ats": "greenhouse", "name": "Algolia", "token": "algolia"}, {"ats": "ashby", "name": "Supabase", "token": "Supabase"}, {"ats": "ashby", "name": "Vanta", "token": "vanta"}, {"ats": "ashby", "name": "ElevenLabs", "token": "elevenlabs"}, {"ats": "ashby", "name": "Render", "token": "render"}, {"ats": "ashby", "name": "OpenAI", "token": "openai"}, {"ats": "ashby", "name": "LangChain", "token": "langchain"}, {"ats": "ashby", "name": "Cursor", "token": "cursor"}, {"ats": "ashby", "name": "Linear", "token": "linear"}, {"ats": "ashby", "name": "Resend", "token": "resend"}, {"ats": "ashby", "name": "Railway", "token": "railway"}, {"ats": "ashby", "name": "Harvey", "token": "harvey"}, {"ats": "lever", "name": "Veeva Systems", "token": "veeva"}, {"ats": "lever", "name": "Spotify", "token": "spotify"}]}	t	\N	\N
9b1385b4-a148-4efb-85c9-c0781f39cd59	himalayas	api	{"pages": 10, "feedUrl": "https://himalayas.app/jobs/api", "linkBackRequired": true}	t	\N	\N
617a22a0-39eb-4346-972d-ed2f95ac0d35	workingnomads	api	{"feedUrl": "https://www.workingnomads.com/api/exposed_jobs/", "linkBackRequired": true}	t	\N	\N
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, password_hash, oauth_provider, oauth_id, digest_enabled, digest_last_sent_at, created_at, updated_at, gmail_refresh_token, language) FROM stdin;
a53e7e4e-5c57-4f09-8678-52dfd0d3757a	a@b.c	\N	\N	\N	t	\N	2026-09-30 09:58:09.288606+00	2026-09-30 09:58:09.288606+00	\N	ru
\.


--
-- Data for Name: vacancies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vacancies (id, source_id, external_id, url, title, company_raw, company_normalized, description, work_format, employment_type, salary_min, salary_max, salary_currency, location, published_at, ingested_at, canonical_vacancy_id, apply_contact, summary_ru, summary_generated_at, seniority, summary_en, summary_en_generated_at) FROM stdin;
aaaaaaaa-0000-0000-0000-000000000001	0dbd72aa-7f9b-4920-9c05-243cf6abef1b	x1	https://x/1	Senior React Dev	Acme	acme	React TypeScript remote	\N	\N	\N	\N	\N	\N	\N	2026-09-30 09:58:09.291157+00	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: applications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.applications (id, user_id, vacancy_id, stage, stage_order, notes, applied_at, last_activity_at, remind_after_days, created_at, updated_at, furthest_stage) FROM stdin;
\.


--
-- Data for Name: apply_drafts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.apply_drafts (id, user_id, vacancy_id, recipient, subject, body, sent_at, created_at) FROM stdin;
\.


--
-- Data for Name: day_plans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.day_plans (id, user_id, plan_date, status, generated_by, intent, accepted_at, closed_at, auto_closed, review, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: digest_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.digest_items (user_id, vacancy_id, score, slot_key, message_id, feedback, sent_at) FROM stdin;
\.


--
-- Data for Name: digest_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.digest_settings (user_id, enabled, send_times, max_items, min_score, created_at, updated_at, last_sent_key) FROM stdin;
\.


--
-- Data for Name: plan_blocks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.plan_blocks (id, plan_id, user_id, "position", title, details, category, source_kind, source_ref, estimate_minutes, corrected_estimate_minutes, actual_minutes, status, skip_reason, outcome_note, carried_from_block_id, carry_count, started_at, completed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: focus_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.focus_sessions (id, block_id, user_id, started_at, ended_at, duration_seconds, ended_reason) FROM stdin;
\.


--
-- Data for Name: hidden_vacancies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.hidden_vacancies (user_id, vacancy_id, hidden_at) FROM stdin;
\.


--
-- Data for Name: resumes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.resumes (id, user_id, filename, file, extracted_text, is_active, uploaded_at) FROM stdin;
\.


--
-- Data for Name: interview_plans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.interview_plans (id, user_id, resume_id, target_role, target_seniority, focus, structure, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: interview_questions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.interview_questions (id, user_id, plan_id, topic, kind, difficulty, prompt, model_answer, created_at) FROM stdin;
\.


--
-- Data for Name: interview_answers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.interview_answers (id, question_id, user_id, answer, review, score, created_at) FROM stdin;
\.


--
-- Data for Name: interview_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.interview_sessions (id, user_id, plan_id, target_role, target_seniority, status, transcript, feedback, started_at, ended_at) FROM stdin;
\.


--
-- Data for Name: interview_topic_progress; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.interview_topic_progress (plan_id, topic_key, status, confidence, updated_at) FROM stdin;
\.


--
-- Data for Name: outreach_emails; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.outreach_emails (id, user_id, vacancy_id, resume_id, recipient, subject, body, gmail_message_id, sent_at) FROM stdin;
\.


--
-- Data for Name: planner_nudges; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.planner_nudges (id, user_id, plan_id, block_id, kind, channel, scheduled_for, status, repeat_index, sent_at, acknowledged_at, telegram_message_id, created_at) FROM stdin;
\.


--
-- Data for Name: planner_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.planner_settings (user_id, timezone, morning_ritual_at, evening_review_at, capacity_minutes, default_block_minutes, category_targets, telegram_enabled, escalation_after_minutes, escalation_max_repeats, estimation_factor, estimation_factor_by_category, updated_at) FROM stdin;
\.


--
-- Data for Name: search_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.search_profiles (id, user_id, name, keywords, stack, work_format, employment_type, salary_min, salary_max, salary_currency, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: profile_matches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.profile_matches (profile_id, vacancy_id, score, matched_at, digested_at) FROM stdin;
\.


--
-- Data for Name: resume_matches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.resume_matches (resume_id, vacancy_id, score, explanation, matched_at, explanation_en, breakdown, breakdown_en) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sessions (id, token, user_id, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: telegram_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.telegram_accounts (user_id, chat_id, username, link_token, link_token_expires_at, linked_at, created_at, updated_at) FROM stdin;
\.


--
-- PostgreSQL database dump complete
--

\unrestrict YK2Gt9zfuvMVtee0LmzEpIBCeKH2ePDtAxolkAczPQF30gV1ItmdDy4UqBtmKNo

