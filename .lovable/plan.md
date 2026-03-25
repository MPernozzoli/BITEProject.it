

# Piano: Profili utente, autori, like, commenti e condivisione

## Panoramica

Estendere il sistema con profili utente riutilizzabili, autori sugli articoli (anche co-autori), like, commenti con risposte/tag/like, e condivisione.

## Nuove tabelle database

### 1. `profiles`
| Colonna | Tipo | Note |
|---------|------|------|
| id | uuid PK | = auth.users.id |
| name | text | nome visualizzato |
| email | text | |
| avatar_url | text | immagine profilo |
| bio | text | biografia |
| created_at | timestamptz | |
| updated_at | timestamptz | |

RLS: ogni utente legge tutti i profili, modifica solo il proprio.
Trigger on auth.users insert per creare profilo automaticamente.

### 2. `profile_badges`
| Colonna | Tipo |
|---------|------|
| id | uuid PK |
| profile_id | uuid FK profiles |
| badge_name | text |
| badge_icon | text |
| awarded_at | timestamptz |

### 3. `article_authors` (relazione many-to-many per co-posting)
| Colonna | Tipo |
|---------|------|
| article_id | uuid FK logbook_articles |
| profile_id | uuid FK profiles |
| role | text (default 'author') |

Questo permette articoli con più autori.

### 4. `article_likes`
| Colonna | Tipo |
|---------|------|
| id | uuid PK |
| article_id | uuid FK |
| profile_id | uuid FK |
| created_at | timestamptz |

Unique constraint su (article_id, profile_id).

### 5. `article_comments`
| Colonna | Tipo |
|---------|------|
| id | uuid PK |
| article_id | uuid FK |
| profile_id | uuid FK |
| parent_id | uuid FK self (nullable, per risposte) |
| content | text |
| created_at | timestamptz |
| updated_at | timestamptz |

### 6. `comment_likes`
| Colonna | Tipo |
|---------|------|
| id | uuid PK |
| comment_id | uuid FK |
| profile_id | uuid FK |
| created_at | timestamptz |

### 7. `comment_mentions`
| Colonna | Tipo |
|---------|------|
| comment_id | uuid FK |
| mentioned_profile_id | uuid FK |
| mentioned_article_id | uuid FK (nullable, per tag articoli) |

## Modifiche alla tabella `logbook_articles`

- Aggiungere colonna `published_at` che diventa editabile (postdatazione)
- Logica: se data futura → status "scheduled"; se data passata o presente → "published" con quella data

## Modifiche al codice

### Editor articoli (`ArticleEditor.tsx`)
- Aggiungere selettore autore/co-autori tra i 3 admin
- Sostituire la logica data: campo data editabile, se futura → scheduled, se passata/presente → pubblicato con quella data

### Pagina articolo (`ArticlePage.tsx`)
- Mostrare nome autore/i con avatar dal profilo
- Sezione like (cuore + conteggio)
- Sezione commenti: form commento, lista commenti con risposte nested, like su commenti, menzioni @utente e @articolo
- Pulsante condivisione (copia link, in futuro social)

### Pagina logbook (`Journal.tsx`)
- Mostrare autore/i su ogni card articolo

### Nuovi componenti
- `ProfileCard.tsx` — card profilo riutilizzabile (avatar, nome, bio, badge)
- `CommentSection.tsx` — commenti con risposte, like, menzioni
- `LikeButton.tsx` — pulsante like riutilizzabile
- `ShareButton.tsx` — copia link + futuro social
- `AuthorSelector.tsx` — selettore autori multipli per l'editor

### Pagina profilo (admin)
- Sezione nel dashboard admin per modificare il proprio profilo (nome, bio, avatar)
- Upload avatar nel bucket `logbook-media`

## RLS Policies

- **profiles**: SELECT per tutti, UPDATE solo il proprio
- **article_authors**: SELECT per tutti, INSERT/DELETE solo authenticated
- **article_likes**: SELECT per tutti, INSERT/DELETE solo il proprio
- **article_comments**: SELECT per tutti, INSERT authenticated, UPDATE/DELETE solo i propri
- **comment_likes**: SELECT per tutti, INSERT/DELETE solo il proprio
- **comment_mentions**: SELECT per tutti, INSERT authenticated

## Ordine di implementazione

1. Migration DB: creare tutte le tabelle con RLS
2. Profili admin: pagina gestione profilo + auto-creazione profilo
3. Autori articoli: editor con selettore co-autori + display su articolo
4. Logica date: postdatazione articoli
5. Like articoli: pulsante + conteggio
6. Commenti: form, lista nested, risposte, menzioni
7. Like commenti
8. Condivisione: copia link

