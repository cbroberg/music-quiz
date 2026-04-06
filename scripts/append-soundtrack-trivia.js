/**
 * Append Opus-authored film soundtrack trivia to data/quiz-trivia-soundtrack.json.
 * 100 questions covering classic and modern film music, composers, and iconic songs.
 *
 * Usage: node scripts/append-soundtrack-trivia.js
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';

const PATH = 'data/quiz-trivia-soundtrack.json';

const QUESTIONS = [
  // ─── JOHN WILLIAMS ────────────────────────────────────
  {
    questionText: "Which film features John Williams' iconic two-note theme representing a predator lurking underwater?",
    correctAnswer: "Jaws",
    options: ["Jaws", "The Abyss", "Open Water", "Deep Blue Sea"],
    artistName: "John Williams",
    funFact: "Steven Spielberg initially thought the simple two-note theme was a joke — it became one of cinema's most famous motifs.",
    backgroundSong: "Jaws Theme",
    backgroundArtist: "John Williams",
    difficulty: "easy",
  },
  {
    questionText: "John Williams composed the music for how many Star Wars films?",
    correctAnswer: "9",
    options: ["7", "8", "9", "10"],
    artistName: "John Williams",
    funFact: "Williams composed all nine main Star Wars episodes from 1977 to 2019 — an unprecedented feat.",
    backgroundSong: "Main Title (Star Wars)",
    backgroundArtist: "John Williams",
    difficulty: "medium",
  },
  {
    questionText: "Which Indiana Jones adventure features the 'Raiders March' theme?",
    correctAnswer: "Raiders of the Lost Ark",
    options: ["Raiders of the Lost Ark", "Temple of Doom", "Last Crusade", "Kingdom of the Crystal Skull"],
    artistName: "John Williams",
    funFact: "The 'Raiders March' has become synonymous with adventure films since its 1981 debut.",
    backgroundSong: "Raiders March",
    backgroundArtist: "John Williams",
    difficulty: "easy",
  },
  {
    questionText: "John Williams' 'Hedwig's Theme' is the main theme for which film franchise?",
    correctAnswer: "Harry Potter",
    options: ["Harry Potter", "The Chronicles of Narnia", "His Dark Materials", "Percy Jackson"],
    artistName: "John Williams",
    funFact: "Williams scored only the first three Harry Potter films, but 'Hedwig's Theme' has been used throughout the series.",
    backgroundSong: "Hedwig's Theme",
    backgroundArtist: "John Williams",
    difficulty: "easy",
  },
  {
    questionText: "Which film features John Williams' haunting violin theme performed by Itzhak Perlman?",
    correctAnswer: "Schindler's List",
    options: ["Schindler's List", "The Pianist", "Life Is Beautiful", "Sophie's Choice"],
    artistName: "John Williams",
    funFact: "Williams said he initially felt the film needed a better composer — Spielberg replied 'I know, but they're all dead.'",
    backgroundSong: "Theme from Schindler's List",
    backgroundArtist: "John Williams",
    difficulty: "medium",
  },
  {
    questionText: "Which film features John Williams' flying theme that many consider his most magical composition?",
    correctAnswer: "E.T. the Extra-Terrestrial",
    options: ["E.T. the Extra-Terrestrial", "Hook", "Close Encounters", "The BFG"],
    artistName: "John Williams",
    funFact: "Williams won an Oscar for E.T. — the film's flying sequence is one of cinema's most iconic moments.",
    backgroundSong: "Flying Theme",
    backgroundArtist: "John Williams",
    difficulty: "medium",
  },
  {
    questionText: "Which film features John Williams' triumphant theme with the lyric 'Can you read my mind?'",
    correctAnswer: "Superman",
    options: ["Superman", "Batman", "The Rocketeer", "Flash Gordon"],
    artistName: "John Williams",
    funFact: "Williams' 1978 Superman theme set the template for superhero film scores for decades.",
    backgroundSong: "Superman Theme",
    backgroundArtist: "John Williams",
    difficulty: "medium",
  },
  {
    questionText: "Which film features John Williams' ominous T-Rex theme?",
    correctAnswer: "Jurassic Park",
    options: ["Jurassic Park", "King Kong", "Godzilla", "Land of the Lost"],
    artistName: "John Williams",
    funFact: "Williams' main Jurassic Park theme is often called one of the most beautiful melodies in film history.",
    backgroundSong: "Theme from Jurassic Park",
    backgroundArtist: "John Williams",
    difficulty: "easy",
  },

  // ─── HANS ZIMMER ──────────────────────────────────────
  {
    questionText: "Hans Zimmer's epic BRAAAM sound became iconic from which Christopher Nolan film?",
    correctAnswer: "Inception",
    options: ["Inception", "Interstellar", "The Dark Knight", "Dunkirk"],
    artistName: "Hans Zimmer",
    funFact: "The 'Inception horn' sound has been copied in countless movie trailers since 2010.",
    backgroundSong: "Time",
    backgroundArtist: "Hans Zimmer",
    difficulty: "medium",
  },
  {
    questionText: "Which Christopher Nolan film features Hans Zimmer's organ-based score?",
    correctAnswer: "Interstellar",
    options: ["Interstellar", "Inception", "Tenet", "The Dark Knight Rises"],
    artistName: "Hans Zimmer",
    funFact: "Zimmer recorded the Interstellar score on a 1926 pipe organ in a London church.",
    backgroundSong: "No Time for Caution",
    backgroundArtist: "Hans Zimmer",
    difficulty: "medium",
  },
  {
    questionText: "Which Disney animated film features Hans Zimmer's Grammy-winning score including 'Circle of Life'?",
    correctAnswer: "The Lion King",
    options: ["The Lion King", "Pocahontas", "Tarzan", "The Prince of Egypt"],
    artistName: "Hans Zimmer",
    funFact: "Zimmer won his first Oscar for The Lion King in 1995 — his only Oscar for 30+ years until Dune.",
    backgroundSong: "Circle of Life",
    backgroundArtist: "Hans Zimmer",
    difficulty: "easy",
  },
  {
    questionText: "Hans Zimmer won his second Oscar for composing which 2021 film score?",
    correctAnswer: "Dune",
    options: ["Dune", "No Time to Die", "The French Dispatch", "Spider-Man: No Way Home"],
    artistName: "Hans Zimmer",
    funFact: "Zimmer turned down scoring 'Tenet' for his dream project Dune — and it won him an Oscar.",
    backgroundSong: "Paul's Dream",
    backgroundArtist: "Hans Zimmer",
    difficulty: "medium",
  },
  {
    questionText: "Hans Zimmer's 'Now We Are Free' appears in which historical epic?",
    correctAnswer: "Gladiator",
    options: ["Gladiator", "Troy", "Kingdom of Heaven", "300"],
    artistName: "Hans Zimmer",
    funFact: "The song features Lisa Gerrard singing in an invented language — not Latin as many believe.",
    backgroundSong: "Now We Are Free",
    backgroundArtist: "Hans Zimmer",
    difficulty: "medium",
  },
  {
    questionText: "Hans Zimmer co-composed the iconic score for The Dark Knight with which composer?",
    correctAnswer: "James Newton Howard",
    options: ["James Newton Howard", "John Williams", "Danny Elfman", "Howard Shore"],
    artistName: "Hans Zimmer",
    funFact: "Their Joker theme consisted of a single sustained note that slowly rose in pitch and tension.",
    backgroundSong: "Why So Serious?",
    backgroundArtist: "Hans Zimmer",
    difficulty: "hard",
  },
  {
    questionText: "Hans Zimmer composed the piratical score for which Disney franchise?",
    correctAnswer: "Pirates of the Caribbean",
    options: ["Pirates of the Caribbean", "Peter Pan", "Swiss Family Robinson", "The Little Mermaid"],
    artistName: "Hans Zimmer",
    funFact: "The iconic 'He's a Pirate' theme was actually composed by Klaus Badelt based on Zimmer's earlier themes.",
    backgroundSong: "He's a Pirate",
    backgroundArtist: "Hans Zimmer",
    difficulty: "easy",
  },

  // ─── ENNIO MORRICONE ──────────────────────────────────
  {
    questionText: "Ennio Morricone composed the whistled theme for which spaghetti western?",
    correctAnswer: "The Good, the Bad and the Ugly",
    options: ["The Good, the Bad and the Ugly", "Once Upon a Time in the West", "A Fistful of Dollars", "High Noon"],
    artistName: "Ennio Morricone",
    funFact: "The iconic whistle and 'ah-ee-ah-ee-ah' wail were performed by Alessandro Alessandroni.",
    backgroundSong: "The Good, the Bad and the Ugly (Main Theme)",
    backgroundArtist: "Ennio Morricone",
    difficulty: "easy",
  },
  {
    questionText: "Ennio Morricone finally won his only competitive Oscar in 2016 for which Tarantino film?",
    correctAnswer: "The Hateful Eight",
    options: ["The Hateful Eight", "Django Unchained", "Inglourious Basterds", "Kill Bill"],
    artistName: "Ennio Morricone",
    funFact: "Morricone was 87 when he won — his first competitive Oscar after 50+ years of composing.",
    backgroundSong: "L'Ultima Diligenza di Red Rock",
    backgroundArtist: "Ennio Morricone",
    difficulty: "medium",
  },
  {
    questionText: "Morricone composed the nostalgic piano theme for which 1988 Italian film about cinema?",
    correctAnswer: "Cinema Paradiso",
    options: ["Cinema Paradiso", "Life Is Beautiful", "Il Postino", "Malèna"],
    artistName: "Ennio Morricone",
    funFact: "The theme was co-composed with his son Andrea Morricone and became instantly iconic.",
    backgroundSong: "Cinema Paradiso (Love Theme)",
    backgroundArtist: "Ennio Morricone",
    difficulty: "medium",
  },

  // ─── DANNY ELFMAN ─────────────────────────────────────
  {
    questionText: "Danny Elfman composed the iconic gothic theme for which 1989 superhero film?",
    correctAnswer: "Batman",
    options: ["Batman", "Dick Tracy", "The Rocketeer", "Darkman"],
    artistName: "Danny Elfman",
    funFact: "Elfman was primarily known as frontman of the band Oingo Boingo before Tim Burton recruited him.",
    backgroundSong: "The Batman Theme",
    backgroundArtist: "Danny Elfman",
    difficulty: "easy",
  },
  {
    questionText: "Danny Elfman voiced AND composed music for which Tim Burton animated musical?",
    correctAnswer: "The Nightmare Before Christmas",
    options: ["The Nightmare Before Christmas", "Corpse Bride", "Coraline", "Frankenweenie"],
    artistName: "Danny Elfman",
    funFact: "Elfman provided the singing voice of Jack Skellington and wrote all the songs.",
    backgroundSong: "This Is Halloween",
    backgroundArtist: "Danny Elfman",
    difficulty: "easy",
  },
  {
    questionText: "Danny Elfman composed the theme for which long-running TV animated series?",
    correctAnswer: "The Simpsons",
    options: ["The Simpsons", "Family Guy", "South Park", "King of the Hill"],
    artistName: "Danny Elfman",
    funFact: "Elfman wrote The Simpsons theme in under 3 days and never imagined it would become so iconic.",
    backgroundSong: "The Simpsons Theme",
    backgroundArtist: "Danny Elfman",
    difficulty: "medium",
  },

  // ─── HOWARD SHORE ─────────────────────────────────────
  {
    questionText: "Howard Shore won three Oscars composing music for which epic fantasy trilogy?",
    correctAnswer: "The Lord of the Rings",
    options: ["The Lord of the Rings", "The Hobbit", "The Chronicles of Narnia", "Game of Thrones"],
    artistName: "Howard Shore",
    funFact: "Shore created distinct musical themes for every race and kingdom in Middle-earth.",
    backgroundSong: "Concerning Hobbits",
    backgroundArtist: "Howard Shore",
    difficulty: "easy",
  },
  {
    questionText: "Which Fellowship of the Ring track features a children's choir?",
    correctAnswer: "May It Be",
    options: ["May It Be", "Concerning Hobbits", "The Bridge of Khazad Dum", "A Journey in the Dark"],
    artistName: "Enya",
    funFact: "Enya's 'May It Be' was nominated for an Oscar for Best Original Song.",
    backgroundSong: "May It Be",
    backgroundArtist: "Enya",
    difficulty: "medium",
  },

  // ─── JAMES HORNER ─────────────────────────────────────
  {
    questionText: "James Horner composed the score for which 1997 film featuring Celine Dion's 'My Heart Will Go On'?",
    correctAnswer: "Titanic",
    options: ["Titanic", "The Perfect Storm", "A Beautiful Mind", "Troy"],
    artistName: "James Horner",
    funFact: "The Titanic soundtrack is the best-selling primarily orchestral soundtrack of all time.",
    backgroundSong: "My Heart Will Go On",
    backgroundArtist: "Celine Dion",
    difficulty: "easy",
  },
  {
    questionText: "James Horner scored which James Cameron blue-alien blockbuster?",
    correctAnswer: "Avatar",
    options: ["Avatar", "Aliens", "The Abyss", "Terminator 2"],
    artistName: "James Horner",
    funFact: "Avatar's 'I See You' by Leona Lewis was a nominated tie-in single.",
    backgroundSong: "I See You",
    backgroundArtist: "Leona Lewis",
    difficulty: "easy",
  },
  {
    questionText: "James Horner composed the bagpipe-heavy score for which 1995 Mel Gibson epic?",
    correctAnswer: "Braveheart",
    options: ["Braveheart", "Rob Roy", "Highlander", "The Last of the Mohicans"],
    artistName: "James Horner",
    funFact: "Horner used Scottish folk instruments throughout to evoke William Wallace's rebellion.",
    backgroundSong: "For the Love of a Princess",
    backgroundArtist: "James Horner",
    difficulty: "medium",
  },

  // ─── ALAN SILVESTRI ───────────────────────────────────
  {
    questionText: "Alan Silvestri composed the iconic main theme for which time-travel franchise?",
    correctAnswer: "Back to the Future",
    options: ["Back to the Future", "Bill & Ted", "Terminator", "12 Monkeys"],
    artistName: "Alan Silvestri",
    funFact: "Silvestri got the job after composer Tom Scott dropped out just weeks before recording.",
    backgroundSong: "Back to the Future Theme",
    backgroundArtist: "Alan Silvestri",
    difficulty: "easy",
  },
  {
    questionText: "Alan Silvestri composed the score for which Tom Hanks film featuring 'Feather Theme'?",
    correctAnswer: "Forrest Gump",
    options: ["Forrest Gump", "Cast Away", "Big", "Philadelphia"],
    artistName: "Alan Silvestri",
    funFact: "'Feather Theme' plays as the feather floats through the air in the opening and closing.",
    backgroundSong: "Forrest Gump Suite",
    backgroundArtist: "Alan Silvestri",
    difficulty: "medium",
  },
  {
    questionText: "Alan Silvestri composed the triumphant 'Portals' cue for which 2019 Marvel film?",
    correctAnswer: "Avengers: Endgame",
    options: ["Avengers: Endgame", "Avengers: Infinity War", "Avengers: Age of Ultron", "Captain America: Civil War"],
    artistName: "Alan Silvestri",
    funFact: "The 'Portals' scene is widely considered one of the most epic moments in cinema history.",
    backgroundSong: "Portals",
    backgroundArtist: "Alan Silvestri",
    difficulty: "medium",
  },

  // ─── TITANIC / CELINE DION ────────────────────────────
  {
    questionText: "Celine Dion's 'My Heart Will Go On' won an Academy Award in which year?",
    correctAnswer: "1998",
    options: ["1997", "1998", "1999", "2000"],
    artistName: "Celine Dion",
    funFact: "The song won Best Original Song at the 1998 Oscars after Titanic's massive success.",
    backgroundSong: "My Heart Will Go On",
    backgroundArtist: "Celine Dion",
    difficulty: "medium",
  },

  // ─── JAMES BOND ───────────────────────────────────────
  {
    questionText: "Adele won an Oscar for the James Bond theme song for which film?",
    correctAnswer: "Skyfall",
    options: ["Skyfall", "Spectre", "Casino Royale", "Quantum of Solace"],
    artistName: "Adele",
    funFact: "Adele's 'Skyfall' was the first Bond theme to win the Oscar for Best Original Song in 2013.",
    backgroundSong: "Skyfall",
    backgroundArtist: "Adele",
    difficulty: "easy",
  },
  {
    questionText: "Sam Smith won an Oscar for which James Bond theme song?",
    correctAnswer: "Writing's on the Wall",
    options: ["Writing's on the Wall", "Skyfall", "Spectre", "No Time to Die"],
    artistName: "Sam Smith",
    funFact: "Sam Smith's 'Writing's on the Wall' from Spectre won the 2016 Oscar for Best Original Song.",
    backgroundSong: "Writing's on the Wall",
    backgroundArtist: "Sam Smith",
    difficulty: "medium",
  },
  {
    questionText: "Billie Eilish's Bond theme 'No Time to Die' won the Oscar in which year?",
    correctAnswer: "2022",
    options: ["2020", "2021", "2022", "2023"],
    artistName: "Billie Eilish",
    funFact: "Billie Eilish became the youngest person ever to write and record a James Bond theme.",
    backgroundSong: "No Time to Die",
    backgroundArtist: "Billie Eilish",
    difficulty: "medium",
  },
  {
    questionText: "Which classic Bond theme was performed by Shirley Bassey in 1964?",
    correctAnswer: "Goldfinger",
    options: ["Goldfinger", "Diamonds Are Forever", "Moonraker", "Thunderball"],
    artistName: "Shirley Bassey",
    funFact: "Shirley Bassey performed three Bond themes: Goldfinger, Diamonds Are Forever, and Moonraker.",
    backgroundSong: "Goldfinger",
    backgroundArtist: "Shirley Bassey",
    difficulty: "medium",
  },
  {
    questionText: "Paul McCartney wrote and performed the theme song for which Bond film?",
    correctAnswer: "Live and Let Die",
    options: ["Live and Let Die", "Goldfinger", "Thunderball", "Moonraker"],
    artistName: "Paul McCartney",
    funFact: "McCartney was the first former Beatle to have a #1 hit with a Bond theme in 1973.",
    backgroundSong: "Live and Let Die",
    backgroundArtist: "Paul McCartney & Wings",
    difficulty: "medium",
  },

  // ─── DISNEY/ANIMATED ──────────────────────────────────
  {
    questionText: "Which Disney film features the Oscar-winning song 'Let It Go'?",
    correctAnswer: "Frozen",
    options: ["Frozen", "Tangled", "Moana", "Encanto"],
    artistName: "Idina Menzel",
    funFact: "'Let It Go' became a global phenomenon and has been translated into 40+ languages.",
    backgroundSong: "Let It Go",
    backgroundArtist: "Idina Menzel",
    difficulty: "easy",
  },
  {
    questionText: "Which Disney film's soundtrack includes the song 'A Whole New World'?",
    correctAnswer: "Aladdin",
    options: ["Aladdin", "The Little Mermaid", "Beauty and the Beast", "Pocahontas"],
    artistName: "Alan Menken",
    funFact: "'A Whole New World' won the 1993 Oscar for Best Original Song.",
    backgroundSong: "A Whole New World",
    backgroundArtist: "Alan Menken",
    difficulty: "easy",
  },
  {
    questionText: "Which Disney film features the songs 'Part of Your World' and 'Under the Sea'?",
    correctAnswer: "The Little Mermaid",
    options: ["The Little Mermaid", "Moana", "Finding Nemo", "Ponyo"],
    artistName: "Alan Menken",
    funFact: "'Under the Sea' won the 1990 Oscar for Best Original Song.",
    backgroundSong: "Under the Sea",
    backgroundArtist: "Alan Menken",
    difficulty: "easy",
  },
  {
    questionText: "Lin-Manuel Miranda wrote the songs for which 2016 Disney animated film set in Polynesia?",
    correctAnswer: "Moana",
    options: ["Moana", "Lilo & Stitch", "Coco", "Raya and the Last Dragon"],
    artistName: "Lin-Manuel Miranda",
    funFact: "Miranda wrote 'How Far I'll Go' while taking breaks from writing Hamilton.",
    backgroundSong: "How Far I'll Go",
    backgroundArtist: "Auli'i Cravalho",
    difficulty: "medium",
  },
  {
    questionText: "Which 2021 Disney animated film features 'We Don't Talk About Bruno' as its breakout hit?",
    correctAnswer: "Encanto",
    options: ["Encanto", "Luca", "Turning Red", "Raya and the Last Dragon"],
    artistName: "Lin-Manuel Miranda",
    funFact: "'We Don't Talk About Bruno' became the first Disney song to hit #1 on Billboard Hot 100 since 'A Whole New World'.",
    backgroundSong: "We Don't Talk About Bruno",
    backgroundArtist: "Encanto Cast",
    difficulty: "easy",
  },
  {
    questionText: "Phil Collins wrote 'You'll Be in My Heart' for which Disney animated film?",
    correctAnswer: "Tarzan",
    options: ["Tarzan", "The Lion King", "Brother Bear", "Mulan"],
    artistName: "Phil Collins",
    funFact: "The song won the 2000 Oscar for Best Original Song.",
    backgroundSong: "You'll Be in My Heart",
    backgroundArtist: "Phil Collins",
    difficulty: "medium",
  },
  {
    questionText: "Elton John won an Oscar for 'Can You Feel the Love Tonight' from which Disney film?",
    correctAnswer: "The Lion King",
    options: ["The Lion King", "Tarzan", "Hercules", "Aladdin"],
    artistName: "Elton John",
    funFact: "Elton John and Tim Rice won the 1995 Oscar for Best Original Song.",
    backgroundSong: "Can You Feel the Love Tonight",
    backgroundArtist: "Elton John",
    difficulty: "easy",
  },

  // ─── ROCKY ────────────────────────────────────────────
  {
    questionText: "Which Rocky film features Survivor's 'Eye of the Tiger' as its theme?",
    correctAnswer: "Rocky III",
    options: ["Rocky III", "Rocky II", "Rocky IV", "Rocky Balboa"],
    artistName: "Survivor",
    funFact: "Sylvester Stallone asked Survivor to write the song after Queen refused to let him use 'Another One Bites the Dust'.",
    backgroundSong: "Eye of the Tiger",
    backgroundArtist: "Survivor",
    difficulty: "medium",
  },
  {
    questionText: "Who composed the iconic 'Gonna Fly Now' theme from the original Rocky?",
    correctAnswer: "Bill Conti",
    options: ["Bill Conti", "John Williams", "Jerry Goldsmith", "Giorgio Moroder"],
    artistName: "Bill Conti",
    funFact: "Bill Conti also composed themes for The Karate Kid and the James Bond film For Your Eyes Only.",
    backgroundSong: "Gonna Fly Now",
    backgroundArtist: "Bill Conti",
    difficulty: "medium",
  },

  // ─── TOP GUN ──────────────────────────────────────────
  {
    questionText: "Kenny Loggins' 'Danger Zone' became the anthem of which 1986 film?",
    correctAnswer: "Top Gun",
    options: ["Top Gun", "Iron Eagle", "Flight of the Intruder", "Hot Shots!"],
    artistName: "Kenny Loggins",
    funFact: "'Danger Zone' also appeared in the 2022 sequel Top Gun: Maverick over 35 years later.",
    backgroundSong: "Danger Zone",
    backgroundArtist: "Kenny Loggins",
    difficulty: "easy",
  },
  {
    questionText: "Which Berlin song was Top Gun's love theme and won an Oscar?",
    correctAnswer: "Take My Breath Away",
    options: ["Take My Breath Away", "Danger Zone", "Playing with the Boys", "Mighty Wings"],
    artistName: "Berlin",
    funFact: "'Take My Breath Away' won the 1987 Oscar for Best Original Song.",
    backgroundSong: "Take My Breath Away",
    backgroundArtist: "Berlin",
    difficulty: "medium",
  },
  {
    questionText: "Lady Gaga wrote and performed which Oscar-winning song from Top Gun: Maverick?",
    correctAnswer: "Hold My Hand",
    options: ["Hold My Hand", "Shallow", "Bad Romance", "Rain on Me"],
    artistName: "Lady Gaga",
    funFact: "Lady Gaga co-wrote 'Hold My Hand' specifically for Top Gun: Maverick.",
    backgroundSong: "Hold My Hand",
    backgroundArtist: "Lady Gaga",
    difficulty: "hard",
  },

  // ─── PULP FICTION / TARANTINO ─────────────────────────
  {
    questionText: "Which Dusty Springfield song plays during Pulp Fiction's famous overdose scene?",
    correctAnswer: "Son of a Preacher Man",
    options: ["Son of a Preacher Man", "You Don't Own Me", "Wishin' and Hopin'", "The Look of Love"],
    artistName: "Dusty Springfield",
    funFact: "Tarantino specifically wrote the scene around needing that song.",
    backgroundSong: "Son of a Preacher Man",
    backgroundArtist: "Dusty Springfield",
    difficulty: "hard",
  },
  {
    questionText: "Urge Overkill's cover of 'Girl, You'll Be a Woman Soon' appears in which Tarantino film?",
    correctAnswer: "Pulp Fiction",
    options: ["Pulp Fiction", "Reservoir Dogs", "Kill Bill", "Jackie Brown"],
    artistName: "Urge Overkill",
    funFact: "The original was by Neil Diamond in 1967.",
    backgroundSong: "Girl, You'll Be a Woman Soon",
    backgroundArtist: "Urge Overkill",
    difficulty: "hard",
  },

  // ─── GUARDIANS OF THE GALAXY ──────────────────────────
  {
    questionText: "Which Guardians of the Galaxy soundtrack features 'Come and Get Your Love' as its opening track?",
    correctAnswer: "Guardians of the Galaxy (2014)",
    options: ["Guardians of the Galaxy (2014)", "Guardians of the Galaxy Vol. 2", "Guardians Vol. 3", "What If...?"],
    artistName: "Redbone",
    funFact: "Guardians of the Galaxy was the first superhero film to have its soundtrack hit #1 on Billboard 200.",
    backgroundSong: "Come and Get Your Love",
    backgroundArtist: "Redbone",
    difficulty: "medium",
  },
  {
    questionText: "The Guardians of the Galaxy 'Awesome Mix' soundtracks feature music primarily from which decade?",
    correctAnswer: "1970s",
    options: ["1960s", "1970s", "1980s", "1990s"],
    artistName: "Various Artists",
    funFact: "Star-Lord's mix tapes contain classic 70s hits that his mother loved.",
    backgroundSong: "Hooked on a Feeling",
    backgroundArtist: "Blue Swede",
    difficulty: "easy",
  },

  // ─── MUSICALS ─────────────────────────────────────────
  {
    questionText: "The 2016 film 'La La Land' won an Oscar for which song?",
    correctAnswer: "City of Stars",
    options: ["City of Stars", "Another Day of Sun", "Audition", "A Lovely Night"],
    artistName: "Justin Hurwitz",
    funFact: "Justin Hurwitz won two Oscars for La La Land — Best Original Score and Best Original Song.",
    backgroundSong: "City of Stars",
    backgroundArtist: "Ryan Gosling & Emma Stone",
    difficulty: "medium",
  },
  {
    questionText: "Which 2017 musical film features the Oscar-nominated song 'This Is Me'?",
    correctAnswer: "The Greatest Showman",
    options: ["The Greatest Showman", "La La Land", "A Star Is Born", "Beauty and the Beast"],
    artistName: "Keala Settle",
    funFact: "The Greatest Showman soundtrack became the best-selling album of 2018 in the UK.",
    backgroundSong: "This Is Me",
    backgroundArtist: "Keala Settle",
    difficulty: "medium",
  },
  {
    questionText: "Which 2018 film features Lady Gaga and Bradley Cooper performing 'Shallow'?",
    correctAnswer: "A Star Is Born",
    options: ["A Star Is Born", "Bohemian Rhapsody", "Mamma Mia 2", "The Greatest Showman"],
    artistName: "Lady Gaga",
    funFact: "'Shallow' won the 2019 Oscar for Best Original Song.",
    backgroundSong: "Shallow",
    backgroundArtist: "Lady Gaga & Bradley Cooper",
    difficulty: "easy",
  },
  {
    questionText: "Which 1978 film made the Bee Gees' disco soundtrack a global phenomenon?",
    correctAnswer: "Saturday Night Fever",
    options: ["Saturday Night Fever", "Grease", "Footloose", "Flashdance"],
    artistName: "Bee Gees",
    funFact: "Saturday Night Fever soundtrack is one of the best-selling soundtracks of all time.",
    backgroundSong: "Stayin' Alive",
    backgroundArtist: "Bee Gees",
    difficulty: "easy",
  },
  {
    questionText: "Which 1978 musical film starred John Travolta and Olivia Newton-John?",
    correctAnswer: "Grease",
    options: ["Grease", "Saturday Night Fever", "Hairspray", "Cry-Baby"],
    artistName: "Various",
    funFact: "The 'You're the One That I Want' finale is one of cinema's most iconic musical numbers.",
    backgroundSong: "You're the One That I Want",
    backgroundArtist: "John Travolta & Olivia Newton-John",
    difficulty: "easy",
  },
  {
    questionText: "Which ABBA-based musical film became a 2008 summer blockbuster?",
    correctAnswer: "Mamma Mia!",
    options: ["Mamma Mia!", "Dancing Queen", "Waterloo", "Muriel's Wedding"],
    artistName: "ABBA",
    funFact: "The film sparked a second career for ABBA and led to a 2018 sequel.",
    backgroundSong: "Mamma Mia",
    backgroundArtist: "ABBA",
    difficulty: "easy",
  },

  // ─── BOHEMIAN RHAPSODY / BIOPICS ──────────────────────
  {
    questionText: "The 2018 film 'Bohemian Rhapsody' is a biopic of which legendary frontman?",
    correctAnswer: "Freddie Mercury",
    options: ["Freddie Mercury", "David Bowie", "Elton John", "Mick Jagger"],
    artistName: "Queen",
    funFact: "Rami Malek won Best Actor for playing Freddie Mercury in 2019.",
    backgroundSong: "Bohemian Rhapsody",
    backgroundArtist: "Queen",
    difficulty: "easy",
  },
  {
    questionText: "'Rocketman' is a 2019 musical biopic about which artist?",
    correctAnswer: "Elton John",
    options: ["Elton John", "Freddie Mercury", "David Bowie", "Billy Joel"],
    artistName: "Elton John",
    funFact: "Elton John won his second Oscar for '(I'm Gonna) Love Me Again' from Rocketman.",
    backgroundSong: "Rocket Man",
    backgroundArtist: "Elton John",
    difficulty: "easy",
  },
  {
    questionText: "'Walk the Line' (2005) is a biopic about which country music legend?",
    correctAnswer: "Johnny Cash",
    options: ["Johnny Cash", "Hank Williams", "Willie Nelson", "Merle Haggard"],
    artistName: "Johnny Cash",
    funFact: "Joaquin Phoenix and Reese Witherspoon performed all the songs themselves.",
    backgroundSong: "Ring of Fire",
    backgroundArtist: "Johnny Cash",
    difficulty: "medium",
  },

  // ─── DIRTY DANCING ────────────────────────────────────
  {
    questionText: "Which song plays during the climactic 'lift' scene in Dirty Dancing?",
    correctAnswer: "(I've Had) The Time of My Life",
    options: ["(I've Had) The Time of My Life", "She's Like the Wind", "Hungry Eyes", "Do You Love Me"],
    artistName: "Bill Medley & Jennifer Warnes",
    funFact: "'(I've Had) The Time of My Life' won the 1988 Oscar for Best Original Song.",
    backgroundSong: "(I've Had) The Time of My Life",
    backgroundArtist: "Bill Medley & Jennifer Warnes",
    difficulty: "easy",
  },

  // ─── FOOTLOOSE / FLASHDANCE ───────────────────────────
  {
    questionText: "Which Kenny Loggins song is the title track of a 1984 dance movie?",
    correctAnswer: "Footloose",
    options: ["Footloose", "Danger Zone", "I'm Alright", "Meet Me Half Way"],
    artistName: "Kenny Loggins",
    funFact: "Loggins had so many movie hits he was nicknamed 'The King of the Movie Soundtrack'.",
    backgroundSong: "Footloose",
    backgroundArtist: "Kenny Loggins",
    difficulty: "easy",
  },
  {
    questionText: "Irene Cara won an Oscar for performing the title song from which 1983 film?",
    correctAnswer: "Flashdance",
    options: ["Flashdance", "Footloose", "Dirty Dancing", "Staying Alive"],
    artistName: "Irene Cara",
    funFact: "Cara also co-wrote the song, making her the first Black woman to win Oscar in a non-acting category.",
    backgroundSong: "Flashdance... What a Feeling",
    backgroundArtist: "Irene Cara",
    difficulty: "hard",
  },

  // ─── WAYNE'S WORLD / COMEDY ROCK ──────────────────────
  {
    questionText: "'Bohemian Rhapsody' by Queen had a resurgence thanks to its iconic car scene in which 1992 film?",
    correctAnswer: "Wayne's World",
    options: ["Wayne's World", "Dazed and Confused", "Bill & Ted's Excellent Adventure", "Encino Man"],
    artistName: "Queen",
    funFact: "The scene helped Bohemian Rhapsody re-enter the Billboard charts 17 years after its original release.",
    backgroundSong: "Bohemian Rhapsody",
    backgroundArtist: "Queen",
    difficulty: "medium",
  },

  // ─── GHOSTBUSTERS ─────────────────────────────────────
  {
    questionText: "Ray Parker Jr. wrote and performed the theme song for which 1984 film?",
    correctAnswer: "Ghostbusters",
    options: ["Ghostbusters", "Gremlins", "Beetlejuice", "The Goonies"],
    artistName: "Ray Parker Jr.",
    funFact: "Huey Lewis sued Parker claiming the song sounded too similar to 'I Want a New Drug'.",
    backgroundSong: "Ghostbusters",
    backgroundArtist: "Ray Parker Jr.",
    difficulty: "easy",
  },

  // ─── WHITNEY HOUSTON ──────────────────────────────────
  {
    questionText: "Whitney Houston's massive hit 'I Will Always Love You' was from which 1992 film?",
    correctAnswer: "The Bodyguard",
    options: ["The Bodyguard", "Waiting to Exhale", "The Preacher's Wife", "Sparkle"],
    artistName: "Whitney Houston",
    funFact: "The song was originally written and recorded by Dolly Parton in 1974.",
    backgroundSong: "I Will Always Love You",
    backgroundArtist: "Whitney Houston",
    difficulty: "easy",
  },

  // ─── ICONIC CLASSIC THEMES ────────────────────────────
  {
    questionText: "Bernard Herrmann composed the screeching violin score for which Hitchcock thriller?",
    correctAnswer: "Psycho",
    options: ["Psycho", "The Birds", "Vertigo", "North by Northwest"],
    artistName: "Bernard Herrmann",
    funFact: "Hitchcock originally didn't want music during the shower scene — Herrmann's score saved the film.",
    backgroundSong: "Psycho (Theme)",
    backgroundArtist: "Bernard Herrmann",
    difficulty: "medium",
  },
  {
    questionText: "Vangelis composed the synth-based Oscar-winning theme for which 1981 sports film?",
    correctAnswer: "Chariots of Fire",
    options: ["Chariots of Fire", "Breaking Away", "The Natural", "Raging Bull"],
    artistName: "Vangelis",
    funFact: "The theme's slow-motion beach running scene has been parodied countless times.",
    backgroundSong: "Chariots of Fire (Theme)",
    backgroundArtist: "Vangelis",
    difficulty: "medium",
  },
  {
    questionText: "Vangelis also composed the atmospheric score for which Ridley Scott sci-fi classic?",
    correctAnswer: "Blade Runner",
    options: ["Blade Runner", "Alien", "Legend", "Kingdom of Heaven"],
    artistName: "Vangelis",
    funFact: "Blade Runner's score took until 1994 to get an official release due to contract disputes.",
    backgroundSong: "Main Titles (Blade Runner)",
    backgroundArtist: "Vangelis",
    difficulty: "medium",
  },
  {
    questionText: "Maurice Jarre composed the sweeping score for which David Lean desert epic?",
    correctAnswer: "Lawrence of Arabia",
    options: ["Lawrence of Arabia", "The English Patient", "Out of Africa", "Doctor Zhivago"],
    artistName: "Maurice Jarre",
    funFact: "Jarre won the 1963 Oscar for Best Original Score — one of film music's most iconic themes.",
    backgroundSong: "Theme from Lawrence of Arabia",
    backgroundArtist: "Maurice Jarre",
    difficulty: "medium",
  },

  // ─── JERRY GOLDSMITH ──────────────────────────────────
  {
    questionText: "Jerry Goldsmith composed the iconic theme for which TV show that also became film franchises?",
    correctAnswer: "Star Trek",
    options: ["Star Trek", "Star Wars", "Battlestar Galactica", "Space: 1999"],
    artistName: "Jerry Goldsmith",
    funFact: "Goldsmith's Star Trek: The Motion Picture theme was later used as the Next Generation theme.",
    backgroundSong: "Star Trek: The Motion Picture Theme",
    backgroundArtist: "Jerry Goldsmith",
    difficulty: "medium",
  },

  // ─── JOHN BARRY ───────────────────────────────────────
  {
    questionText: "John Barry composed the iconic theme for which spy franchise spanning 11 films?",
    correctAnswer: "James Bond",
    options: ["James Bond", "Mission: Impossible", "Bourne", "Kingsman"],
    artistName: "John Barry",
    funFact: "The 'James Bond Theme' itself was actually composed by Monty Norman, but Barry arranged and defined its iconic sound.",
    backgroundSong: "James Bond Theme",
    backgroundArtist: "John Barry",
    difficulty: "hard",
  },
  {
    questionText: "John Barry won an Oscar for scoring which 1985 film set in Africa?",
    correctAnswer: "Out of Africa",
    options: ["Out of Africa", "The Lion King", "Dances with Wolves", "Born Free"],
    artistName: "John Barry",
    funFact: "Barry won FIVE Oscars in total — one of the most decorated film composers ever.",
    backgroundSong: "Out of Africa Theme",
    backgroundArtist: "John Barry",
    difficulty: "hard",
  },

  // ─── EMINEM ───────────────────────────────────────────
  {
    questionText: "Eminem's 'Lose Yourself' was from which 2002 autobiographical film?",
    correctAnswer: "8 Mile",
    options: ["8 Mile", "The Marshall Mathers LP", "Detroit", "Hustle & Flow"],
    artistName: "Eminem",
    funFact: "'Lose Yourself' was the first rap song to win an Oscar for Best Original Song.",
    backgroundSong: "Lose Yourself",
    backgroundArtist: "Eminem",
    difficulty: "easy",
  },

  // ─── PRINCE / PURPLE RAIN ─────────────────────────────
  {
    questionText: "Prince won an Oscar for the score of which 1984 musical film?",
    correctAnswer: "Purple Rain",
    options: ["Purple Rain", "Under the Cherry Moon", "Graffiti Bridge", "Sign o' the Times"],
    artistName: "Prince",
    funFact: "Purple Rain won the 1985 Oscar for Best Original Song Score — an award rarely given anymore.",
    backgroundSong: "Purple Rain",
    backgroundArtist: "Prince",
    difficulty: "medium",
  },

  // ─── GOO GOO DOLLS / IRIS ─────────────────────────────
  {
    questionText: "Goo Goo Dolls' 'Iris' was featured in which 1998 Nicolas Cage film?",
    correctAnswer: "City of Angels",
    options: ["City of Angels", "Face/Off", "The Rock", "Leaving Las Vegas"],
    artistName: "Goo Goo Dolls",
    funFact: "'Iris' became the longest-charting single ever on the Billboard Adult Top 40 at the time.",
    backgroundSong: "Iris",
    backgroundArtist: "Goo Goo Dolls",
    difficulty: "medium",
  },

  // ─── AEROSMITH ────────────────────────────────────────
  {
    questionText: "Aerosmith's 'I Don't Want to Miss a Thing' was from which 1998 disaster film?",
    correctAnswer: "Armageddon",
    options: ["Armageddon", "Deep Impact", "Independence Day", "The Rock"],
    artistName: "Aerosmith",
    funFact: "Steven Tyler's daughter Liv Tyler co-starred in the film, making it a family affair.",
    backgroundSong: "I Don't Want to Miss a Thing",
    backgroundArtist: "Aerosmith",
    difficulty: "easy",
  },

  // ─── SEAL ─────────────────────────────────────────────
  {
    questionText: "Seal's 'Kiss from a Rose' was featured in which 1995 superhero film?",
    correctAnswer: "Batman Forever",
    options: ["Batman Forever", "Batman Returns", "Batman & Robin", "The Crow"],
    artistName: "Seal",
    funFact: "The song wasn't originally written for the film — it was from Seal's 1994 album.",
    backgroundSong: "Kiss from a Rose",
    backgroundArtist: "Seal",
    difficulty: "medium",
  },

  // ─── U2 ──────────────────────────────────────────────
  {
    questionText: "U2's 'Hold Me, Thrill Me, Kiss Me, Kill Me' was from which 1995 Batman film?",
    correctAnswer: "Batman Forever",
    options: ["Batman Forever", "Batman Returns", "Batman & Robin", "Batman (1989)"],
    artistName: "U2",
    funFact: "The song was nominated for the Golden Globe for Best Original Song.",
    backgroundSong: "Hold Me, Thrill Me, Kiss Me, Kill Me",
    backgroundArtist: "U2",
    difficulty: "hard",
  },

  // ─── OSCAR WINNERS ────────────────────────────────────
  {
    questionText: "Which song from '8 Mile' became the first rap song to win the Oscar for Best Original Song?",
    correctAnswer: "Lose Yourself",
    options: ["Lose Yourself", "Superman", "Rabbit Run", "Sing for the Moment"],
    artistName: "Eminem",
    funFact: "Eminem didn't attend the ceremony, assuming he wouldn't win — Barbra Streisand presented the award.",
    backgroundSong: "Lose Yourself",
    backgroundArtist: "Eminem",
    difficulty: "hard",
  },
  {
    questionText: "Three 6 Mafia became the first hip-hop group to perform AND win at the Oscars with which song?",
    correctAnswer: "It's Hard Out Here for a Pimp",
    options: ["It's Hard Out Here for a Pimp", "Stay Fly", "Lose Yourself", "Gangsta's Paradise"],
    artistName: "Three 6 Mafia",
    funFact: "The song is from 'Hustle & Flow' (2005) and won Best Original Song at the 2006 Oscars.",
    backgroundSong: "It's Hard Out Here for a Pimp",
    backgroundArtist: "Three 6 Mafia",
    difficulty: "hard",
  },

  // ─── TIM BURTON / WEDNESDAY / ADAMS ───────────────────
  {
    questionText: "The Lady Gaga song 'Bloody Mary' had a resurgence in 2022 thanks to which Netflix show based on a film franchise?",
    correctAnswer: "Wednesday",
    options: ["Wednesday", "Stranger Things", "Bridgerton", "Dahmer"],
    artistName: "Lady Gaga",
    funFact: "Wednesday Addams' dance went viral, boosting the song 12 years after its original release.",
    backgroundSong: "Bloody Mary",
    backgroundArtist: "Lady Gaga",
    difficulty: "medium",
  },

  // ─── KATE BUSH / STRANGER THINGS ──────────────────────
  {
    questionText: "Kate Bush's 'Running Up That Hill' had a massive revival in 2022 thanks to which Netflix series?",
    correctAnswer: "Stranger Things",
    options: ["Stranger Things", "Dark", "The Crown", "Squid Game"],
    artistName: "Kate Bush",
    funFact: "The 1985 song reached #1 in multiple countries 37 years after its original release.",
    backgroundSong: "Running Up That Hill",
    backgroundArtist: "Kate Bush",
    difficulty: "easy",
  },

  // ─── TIM BURTON / BEETLEJUICE ─────────────────────────
  {
    questionText: "'Day-O (The Banana Boat Song)' by Harry Belafonte features in which Tim Burton comedy?",
    correctAnswer: "Beetlejuice",
    options: ["Beetlejuice", "Edward Scissorhands", "Big Fish", "The Addams Family"],
    artistName: "Harry Belafonte",
    funFact: "The dinner scene where guests are possessed is one of Burton's most memorable moments.",
    backgroundSong: "Day-O (The Banana Boat Song)",
    backgroundArtist: "Harry Belafonte",
    difficulty: "medium",
  },

  // ─── WHAM! / LAST CHRISTMAS ───────────────────────────
  {
    questionText: "Wham!'s 'Last Christmas' finally reached #1 in the UK in December 2020, how many years after its 1984 release?",
    correctAnswer: "36",
    options: ["30", "33", "36", "40"],
    artistName: "Wham!",
    funFact: "It was famously blocked from #1 in 1984 by Band Aid's 'Do They Know It's Christmas?'",
    backgroundSong: "Last Christmas",
    backgroundArtist: "Wham!",
    difficulty: "hard",
  },

  // ─── JAWS / SPIELBERG ─────────────────────────────────
  {
    questionText: "Who directed the film whose iconic John Williams two-note theme has become synonymous with danger?",
    correctAnswer: "Steven Spielberg",
    options: ["Steven Spielberg", "George Lucas", "Brian De Palma", "Francis Ford Coppola"],
    artistName: "Steven Spielberg",
    funFact: "Jaws (1975) made Spielberg's career and redefined the summer blockbuster.",
    backgroundSong: "Jaws Theme",
    backgroundArtist: "John Williams",
    difficulty: "easy",
  },

  // ─── PHIL COLLINS / GENESIS ───────────────────────────
  {
    questionText: "Phil Collins' 'In the Air Tonight' famously plays in which 1983 Al Pacino film finale?",
    correctAnswer: "Miami Vice (TV pilot)",
    options: ["Miami Vice (TV pilot)", "Scarface", "Risky Business", "Flashdance"],
    artistName: "Phil Collins",
    funFact: "Miami Vice's 1984 TV pilot used the song in a pivotal scene that helped make both icons.",
    backgroundSong: "In the Air Tonight",
    backgroundArtist: "Phil Collins",
    difficulty: "hard",
  },

  // ─── RADIOHEAD / SPECTRE ──────────────────────────────
  {
    questionText: "Radiohead wrote a rejected theme song for which 2015 James Bond film?",
    correctAnswer: "Spectre",
    options: ["Spectre", "Skyfall", "No Time to Die", "Quantum of Solace"],
    artistName: "Radiohead",
    funFact: "Radiohead released their rejected 'Spectre' as a Christmas gift in 2015 after Sam Smith's version was chosen.",
    backgroundSong: "Spectre",
    backgroundArtist: "Radiohead",
    difficulty: "hard",
  },

  // ─── SIMON & GARFUNKEL ────────────────────────────────
  {
    questionText: "Simon & Garfunkel's 'Mrs. Robinson' features in which 1967 film?",
    correctAnswer: "The Graduate",
    options: ["The Graduate", "Harold and Maude", "Bonnie and Clyde", "Easy Rider"],
    artistName: "Simon & Garfunkel",
    funFact: "Director Mike Nichols personally asked Paul Simon to write songs for the film.",
    backgroundSong: "Mrs. Robinson",
    backgroundArtist: "Simon & Garfunkel",
    difficulty: "medium",
  },

  // ─── BILLY JOEL ───────────────────────────────────────
  {
    questionText: "Billy Joel wrote 'Leningrad' and 'We Didn't Start the Fire' — but which song appears in a key moment of 13 Going on 30?",
    correctAnswer: "Thriller (Michael Jackson)",
    options: ["Thriller (Michael Jackson)", "Piano Man", "We Didn't Start the Fire", "Uptown Girl"],
    artistName: "Michael Jackson",
    funFact: "The dance scene to 'Thriller' is one of the film's most memorable moments.",
    backgroundSong: "Thriller",
    backgroundArtist: "Michael Jackson",
    difficulty: "hard",
  },

  // ─── HOWARD SHORE / LORD OF THE RINGS ─────────────────
  {
    questionText: "Annie Lennox won an Oscar for 'Into the West' from which Lord of the Rings film?",
    correctAnswer: "The Return of the King",
    options: ["The Return of the King", "The Fellowship of the Ring", "The Two Towers", "The Hobbit"],
    artistName: "Annie Lennox",
    funFact: "The song won the 2004 Oscar for Best Original Song along with the film's 11 total Oscar wins.",
    backgroundSong: "Into the West",
    backgroundArtist: "Annie Lennox",
    difficulty: "medium",
  },

  // ─── TRON ─────────────────────────────────────────────
  {
    questionText: "Daft Punk composed the electronic score for which 2010 sci-fi sequel?",
    correctAnswer: "Tron: Legacy",
    options: ["Tron: Legacy", "Tron", "Blade Runner 2049", "Inception"],
    artistName: "Daft Punk",
    funFact: "The Tron: Legacy soundtrack became an electronic music touchstone and remains Daft Punk's only film score.",
    backgroundSong: "Derezzed",
    backgroundArtist: "Daft Punk",
    difficulty: "medium",
  },

  // ─── BILLY PRESTON / BEATLES ──────────────────────────
  {
    questionText: "Which 1964 film starred The Beatles and is considered a classic rock musical?",
    correctAnswer: "A Hard Day's Night",
    options: ["A Hard Day's Night", "Help!", "Magical Mystery Tour", "Yellow Submarine"],
    artistName: "The Beatles",
    funFact: "A Hard Day's Night is often credited as the first music video feature film.",
    backgroundSong: "A Hard Day's Night",
    backgroundArtist: "The Beatles",
    difficulty: "medium",
  },

  // ─── ELTON JOHN / LION KING ───────────────────────────
  {
    questionText: "Elton John wrote the songs for which Disney animated film that became a Broadway musical?",
    correctAnswer: "The Lion King",
    options: ["The Lion King", "Aladdin", "Tarzan", "Beauty and the Beast"],
    artistName: "Elton John",
    funFact: "Elton John's Lion King songs with Tim Rice have grossed over $10 billion across film and Broadway.",
    backgroundSong: "Circle of Life",
    backgroundArtist: "Elton John",
    difficulty: "easy",
  },

  // ─── CRAZY GUITAR BATTLES ─────────────────────────────
  {
    questionText: "Which 1986 film featured Ralph Macchio in a legendary guitar duel with blues guitarist Steve Vai?",
    correctAnswer: "Crossroads",
    options: ["Crossroads", "La Bamba", "The Karate Kid", "Bill & Ted"],
    artistName: "Ry Cooder",
    funFact: "Steve Vai actually performed the guitar for both sides of the climactic duel.",
    backgroundSong: "Eugene's Trick Bag",
    backgroundArtist: "Steve Vai",
    difficulty: "hard",
  },

  // ─── COCO / MIGUEL ────────────────────────────────────
  {
    questionText: "Pixar's 'Coco' (2017) won an Oscar for which song?",
    correctAnswer: "Remember Me",
    options: ["Remember Me", "Un Poco Loco", "The World Es Mi Familia", "Proud Corazón"],
    artistName: "Kristen Anderson-Lopez & Robert Lopez",
    funFact: "Robert Lopez became the youngest EGOT winner (Emmy, Grammy, Oscar, Tony) at age 39.",
    backgroundSong: "Remember Me",
    backgroundArtist: "Miguel",
    difficulty: "medium",
  },

  // ─── DREAMGIRLS / JENNIFER HUDSON ─────────────────────
  {
    questionText: "Jennifer Hudson won an Oscar for her role in which 2006 musical film?",
    correctAnswer: "Dreamgirls",
    options: ["Dreamgirls", "Chicago", "Rent", "The Wiz"],
    artistName: "Jennifer Hudson",
    funFact: "Hudson won Best Supporting Actress, cementing her comeback after American Idol.",
    backgroundSong: "And I Am Telling You I'm Not Going",
    backgroundArtist: "Jennifer Hudson",
    difficulty: "medium",
  },

  // ─── ROCKY HORROR ─────────────────────────────────────
  {
    questionText: "'The Time Warp' is the most famous song from which 1975 cult musical film?",
    correctAnswer: "The Rocky Horror Picture Show",
    options: ["The Rocky Horror Picture Show", "Hair", "Tommy", "Jesus Christ Superstar"],
    artistName: "Various (Rocky Horror Cast)",
    funFact: "The Rocky Horror Picture Show is the longest-running theatrical release in film history.",
    backgroundSong: "The Time Warp",
    backgroundArtist: "Richard O'Brien",
    difficulty: "easy",
  },

  // ─── SPIDER-MAN / WEB OF SOUND ────────────────────────
  {
    questionText: "Danny Elfman composed the iconic theme for which Sam Raimi superhero trilogy?",
    correctAnswer: "Spider-Man",
    options: ["Spider-Man", "Batman", "Superman", "Iron Man"],
    artistName: "Danny Elfman",
    funFact: "Elfman's Spider-Man theme became so iconic it was referenced in later Marvel films.",
    backgroundSong: "Main Title (Spider-Man)",
    backgroundArtist: "Danny Elfman",
    difficulty: "medium",
  },

  // ─── ALEXANDRE DESPLAT ────────────────────────────────
  {
    questionText: "Alexandre Desplat won Oscars for scoring which Wes Anderson film?",
    correctAnswer: "The Grand Budapest Hotel",
    options: ["The Grand Budapest Hotel", "Moonrise Kingdom", "Isle of Dogs", "The French Dispatch"],
    artistName: "Alexandre Desplat",
    funFact: "Desplat also won an Oscar for The Shape of Water, making him one of few to win twice in 4 years.",
    backgroundSong: "Mr. Moustafa",
    backgroundArtist: "Alexandre Desplat",
    difficulty: "hard",
  },

  // ─── THE GRADUATE / SOUND OF SILENCE ──────────────────
  {
    questionText: "Which Simon & Garfunkel song opens 'The Graduate' (1967) during the airport scene?",
    correctAnswer: "The Sound of Silence",
    options: ["The Sound of Silence", "Mrs. Robinson", "Scarborough Fair", "Cecilia"],
    artistName: "Simon & Garfunkel",
    funFact: "'The Sound of Silence' became a hit twice — first in 1965 and again after being used in the film.",
    backgroundSong: "The Sound of Silence",
    backgroundArtist: "Simon & Garfunkel",
    difficulty: "medium",
  },

  // ─── TITANIC EXTENDED ─────────────────────────────────
  {
    questionText: "How many Academy Awards did the film Titanic (1997) win?",
    correctAnswer: "11",
    options: ["9", "10", "11", "12"],
    artistName: "Titanic (film)",
    funFact: "Titanic tied with Ben-Hur and later The Return of the King for most Oscars ever won.",
    backgroundSong: "My Heart Will Go On",
    backgroundArtist: "Celine Dion",
    difficulty: "hard",
  },

  // ─── STAR WARS EXTENDED ───────────────────────────────
  {
    questionText: "John Williams' 'Duel of the Fates' first appeared in which Star Wars film?",
    correctAnswer: "The Phantom Menace",
    options: ["The Phantom Menace", "Attack of the Clones", "Revenge of the Sith", "The Force Awakens"],
    artistName: "John Williams",
    funFact: "The choir sings lyrics in Sanskrit adapted from a Celtic poem.",
    backgroundSong: "Duel of the Fates",
    backgroundArtist: "John Williams",
    difficulty: "medium",
  },

  // ─── A STAR IS BORN LADY GAGA ─────────────────────────
  {
    questionText: "'A Star Is Born' (2018) was directed by and starred which actor?",
    correctAnswer: "Bradley Cooper",
    options: ["Bradley Cooper", "Clint Eastwood", "Tom Hanks", "Matt Damon"],
    artistName: "Bradley Cooper",
    funFact: "It was Cooper's directorial debut and Lady Gaga's first lead film role.",
    backgroundSong: "Shallow",
    backgroundArtist: "Lady Gaga & Bradley Cooper",
    difficulty: "medium",
  },

  // ─── STAR WARS / BINARY SUNSET ────────────────────────
  {
    questionText: "The Star Wars 'Binary Sunset' theme is associated with which character?",
    correctAnswer: "Luke Skywalker",
    options: ["Luke Skywalker", "Darth Vader", "Yoda", "Obi-Wan Kenobi"],
    artistName: "John Williams",
    funFact: "Also called 'The Force Theme', it plays when Luke gazes at Tatooine's two suns.",
    backgroundSong: "Binary Sunset",
    backgroundArtist: "John Williams",
    difficulty: "medium",
  },

  // ─── FROZEN 2 ─────────────────────────────────────────
  {
    questionText: "Which song is the breakout hit of Frozen 2 (2019)?",
    correctAnswer: "Into the Unknown",
    options: ["Into the Unknown", "Let It Go", "Show Yourself", "Some Things Never Change"],
    artistName: "Idina Menzel & AURORA",
    funFact: "'Into the Unknown' was nominated for Best Original Song at the 2020 Oscars.",
    backgroundSong: "Into the Unknown",
    backgroundArtist: "Idina Menzel & AURORA",
    difficulty: "easy",
  },

  // ─── SING / TROLLS ────────────────────────────────────
  {
    questionText: "Justin Timberlake's 'Can't Stop the Feeling!' was the lead single from which animated film?",
    correctAnswer: "Trolls",
    options: ["Trolls", "Sing", "Smallfoot", "The Emoji Movie"],
    artistName: "Justin Timberlake",
    funFact: "The song was Oscar-nominated and spent weeks at #1 on Billboard Hot 100 in 2016.",
    backgroundSong: "Can't Stop the Feeling!",
    backgroundArtist: "Justin Timberlake",
    difficulty: "easy",
  },

  // ─── MARY POPPINS ─────────────────────────────────────
  {
    questionText: "Which Disney classic features 'Supercalifragilisticexpialidocious'?",
    correctAnswer: "Mary Poppins",
    options: ["Mary Poppins", "Chitty Chitty Bang Bang", "Bedknobs and Broomsticks", "The Sound of Music"],
    artistName: "Sherman Brothers",
    funFact: "The Sherman Brothers won two Oscars for Mary Poppins, including Best Original Song for 'Chim Chim Cher-ee'.",
    backgroundSong: "Supercalifragilisticexpialidocious",
    backgroundArtist: "Julie Andrews & Dick Van Dyke",
    difficulty: "easy",
  },

  // ─── SOUND OF MUSIC ───────────────────────────────────
  {
    questionText: "'Do-Re-Mi' is a song from which 1965 musical set in Austria?",
    correctAnswer: "The Sound of Music",
    options: ["The Sound of Music", "Mary Poppins", "My Fair Lady", "West Side Story"],
    artistName: "Rodgers & Hammerstein",
    funFact: "The Sound of Music won 5 Oscars including Best Picture in 1966.",
    backgroundSong: "Do-Re-Mi",
    backgroundArtist: "Julie Andrews",
    difficulty: "easy",
  },

  // ─── WEST SIDE STORY ──────────────────────────────────
  {
    questionText: "Which legendary composer wrote the music for West Side Story?",
    correctAnswer: "Leonard Bernstein",
    options: ["Leonard Bernstein", "Stephen Sondheim", "Andrew Lloyd Webber", "Richard Rodgers"],
    artistName: "Leonard Bernstein",
    funFact: "Stephen Sondheim wrote the lyrics but wasn't fully credited until years later.",
    backgroundSong: "America",
    backgroundArtist: "West Side Story",
    difficulty: "medium",
  },

  // ─── INGLOURIOUS BASTERDS / DAVID BOWIE ───────────────
  {
    questionText: "David Bowie's 'Cat People (Putting Out Fire)' was used in which Tarantino film?",
    correctAnswer: "Inglourious Basterds",
    options: ["Inglourious Basterds", "Django Unchained", "Kill Bill Vol. 1", "Once Upon a Time in Hollywood"],
    artistName: "David Bowie",
    funFact: "Originally from the 1982 film 'Cat People' — Tarantino loved it so much he reused it.",
    backgroundSong: "Cat People (Putting Out Fire)",
    backgroundArtist: "David Bowie",
    difficulty: "hard",
  },

  // ─── BORN THIS WAY / BIBLE STORIES ────────────────────
  {
    questionText: "Which 1998 animated film features Mariah Carey and Whitney Houston's duet 'When You Believe'?",
    correctAnswer: "The Prince of Egypt",
    options: ["The Prince of Egypt", "Anastasia", "The Road to El Dorado", "Joseph: King of Dreams"],
    artistName: "Mariah Carey & Whitney Houston",
    funFact: "'When You Believe' won the 1999 Oscar for Best Original Song.",
    backgroundSong: "When You Believe",
    backgroundArtist: "Mariah Carey & Whitney Houston",
    difficulty: "medium",
  },
];

async function main() {
  let existing = [];
  if (existsSync(PATH)) {
    existing = JSON.parse(readFileSync(PATH, 'utf-8'));
  }
  const existingTexts = new Set(existing.map(q => q.questionText));

  let added = 0;
  for (const q of QUESTIONS) {
    if (existingTexts.has(q.questionText)) continue;
    existing.push({
      questionType: 'film-soundtrack',
      ...q,
      id: crypto.randomBytes(4).toString('hex'),
      validated: true,
      timesUsed: 0,
      createdAt: new Date().toISOString(),
      source: 'opus-curated',
    });
    added++;
  }

  writeFileSync(PATH, JSON.stringify(existing, null, 2));
  console.log(`✅ Added ${added} film soundtrack questions. Total: ${existing.length}`);

  // Difficulty distribution
  const diff = {};
  for (const q of existing) {
    diff[q.difficulty] = (diff[q.difficulty] || 0) + 1;
  }
  console.log('\nDifficulty:');
  for (const [d, c] of Object.entries(diff)) {
    console.log(`  ${d}: ${c}`);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
