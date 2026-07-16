-- Known limitations per measured variable.
--
-- /Data/sensors used to hard-code its sensor list, so it already disagreed with the catalog
-- (seven entries against ten rows). Moving the page onto observation_parameters would have
-- dropped the one thing a researcher most needs — what to distrust about each reading — so
-- the copy moves into the catalog instead of being thrown away.

alter table public.observation_parameters
  add column if not exists limitations_en text,
  add column if not exists limitations_it text;

comment on column public.observation_parameters.limitations_en is
  'What to distrust about this variable: how the platform biases it. Rendered on /Data/sensors. Null means undocumented, which for a published variable is a gap to fill, not a claim of accuracy.';

update public.observation_parameters set
  limitations_en = 'Readings reflect hull-depth temperature, not true skin SST. Accuracy is affected by boat speed and by solar heating of the hull.',
  limitations_it = 'Le letture riflettono la temperatura alla profondità dello scafo, non una vera SST superficiale. L''accuratezza è influenzata dalla velocità della barca e dal riscaldamento solare dello scafo.'
where code = 'sst';

update public.observation_parameters set
  limitations_en = 'The sensor can be influenced by engine heat or by solar radiation on deck in calm conditions.',
  limitations_it = 'Il sensore può essere influenzato dal calore del motore o dall''irraggiamento solare in coperta con mare calmo.'
where code = 'air_temp';

update public.observation_parameters set
  limitations_en = 'Salt spray can temporarily affect readings. The sensor requires periodic calibration in marine environments.',
  limitations_it = 'Gli spruzzi salini possono alterare temporaneamente le letture. Il sensore richiede calibrazioni periodiche in ambiente marino.'
where code = 'humidity';

update public.observation_parameters set
  limitations_en = 'Minor variations are possible due to vessel movement. No altitude correction is required at sea level.',
  limitations_it = 'Sono possibili variazioni minori dovute al movimento della barca. Al livello del mare non serve correzione di quota.'
where code = 'pressure';

update public.observation_parameters set
  limitations_en = 'The apparent-to-true wind conversion introduces small errors, and masthead turbulence from the sails can affect readings.',
  limitations_it = 'La conversione da vento apparente a vento reale introduce piccoli errori, e la turbolenza delle vele in testa d''albero può alterare le letture.'
where code in ('wind_speed', 'wind_direction');

update public.observation_parameters set
  limitations_en = 'Subjective, recorded at irregular intervals, and dependent on crew attention and conditions.',
  limitations_it = 'Soggettivo, registrato a intervalli irregolari e dipendente dall''attenzione dell''equipaggio e dalle condizioni.'
where code = 'sea_state';

-- dissolved_oxygen, salinity and plankton_density are deliberately left null: the probes are
-- not on board yet, and inventing their failure modes would be worse than an honest blank.
