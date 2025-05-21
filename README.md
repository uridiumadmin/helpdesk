# Uridium Helpdesk – Development Environment

Ovo je moderni Helpdesk UI i backend razvijen za Uridium, optimizovan za brzu izradu i testiranje novih funkcionalnosti uz pomoć AI (Codex/ChatGPT).

---

## 🚀 Tehnologije

- **Frontend:** Vue 3, Tailwind CSS, Frappe UI
- **Backend:** Frappe (Python) *(ako koristiš backend, navedi tačnu putanju dole)*
- **Build alati:** Yarn (ili npm)

---

## 📂 Struktura projekta

helpdesk/
├── desk/
│ └── src/
│ ├── assets/ # Stilovi, slike, ikonice
│ └── components/ # Vue komponente (ticket, comments, activity, time entry itd.)
│ ├── ticket/
│ ├── comments/
│ ├── activity/
│ ├── time-entry/
│ ├── ... (ostale grupe komponenti)
├── helpers/ # Helpers/utilities
├── workflows/ # Workflow konfiguracije
├── package.json # Frontend dependencies
├── requirements.txt # Backend dependencies (ako koristiš Python backend)
└── README.md


- **Glavni frontend kod:** `desk/src/components/`
  - Podfolderi: `ticket/`, `comments/`, `activity/`, `time-entry/`, itd.
- **Assets (slike, ikonice, stilovi):** `desk/src/assets/`
- **Helpers, workflows:** u root folderima
- **Backend kod:** *(navedi gde je – npr. `apps/helpdesk/helpdesk/` ili `backend/`)*
- **Testovi:** *(navedi gde su, npr. `tests/` ili `desk/tests/`)*

---

## 🛠️ Build & Pokretanje

**Frontend:**
```bash
cd desk
yarn install      # ili npm install
yarn dev          # ili npm run dev

**Backend Frappe/Python):**

helpdesk/helpdesk folder i podfolderi

pip install -r requirements.txt



🤖 Codex/ChatGPT/AI – Task Brief
Ovo okruženje je pripremljeno za razvoj i generisanje novih funkcionalnosti uz AI asistente (Codex, ChatGPT).

Glavni taskovi za AI:
Dodavanje i proširenje Vue komponenti (tabovi, modali, sidebar elementi…)

Dodavanje Time Entry tab-a i integracije sa Activity feed-om i sidebar štopericom

Proširenje postojeće funkcionalnosti za tickets, comments, notifications

Koristi Frappe UI komponente i Tailwind CSS za frontend kod

Povezivanje frontenda i backenda kroz REST/Frappe RPC

Glavni frontend kod nalazi se u:
desk/src/components/

📌 Primeri taskova za AI
Dodaj tab “Time Entry” u ticket view (desk/src/components/ticket/), sa istim izgledom i funkcijom kao Comments tab.

Prikaži sve unose vremena u Time Entry tab-u, koristi dizajn Comments liste.

Dodaj dugme “New Time Entry” (desno, kao New Comment) koje otvara modal (Frappe UI).

Unosi vremena moraju biti vidljivi i u Activity feed-u.

U sidebar (desni deo, na dnu) dodaj štopericu (timer) kao Vue komponentu, koristi Frappe UI i Tailwind.

Poveži Time Entry tab i sidebar štopericu sa backend-om (ako postoji API).



🧑‍💻 Saveti za razvoj
Svi novi UI elementi treba da koriste Frappe UI komponente i Tailwind klase za stil.

Vue komponente organizuj u odgovarajuće podfoldere unutar desk/src/components/.

Izmene backend koda piši u dogovorenoj backend lokaciji.

README.md ažuriraj kod većih promena u strukturi.



<div align="center" markdown="1">

<img src=".github/hd-logo.svg" alt="Frappe Helpdesk logo" width="80"/>
<h1>Frappe Helpdesk</h1>

**Customer Service, Made Simple and Effective**

![GitHub release (latest by date)](https://img.shields.io/github/v/release/frappe/helpdesk)
[![codecov](https://codecov.io/github/frappe/helpdesk/branch/develop/graph/badge.svg?token=8ZXHCY4G9U)](https://codecov.io/github/frappe/helpdesk)

<a href="https://trendshift.io/repositories/12764" target="_blank"><img src="https://trendshift.io/api/badge/repositories/12764" alt="teableio%2Fteable | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</div>

</div>


<div align="center">
	<img src="./.github/Hero2.png" alt="Hero Image" width="100%" />
</div>
<br />
<div align="center">
	<a href="https://frappe.io/helpdesk">Website</a>
	-
	<a href="https://docs.frappe.io/helpdesk">Documentation</a>
</div>

## Frappe Helpdesk
Frappe Helpdesk is an 100% open-source Ticket Management tool which helps you  streamline your company's support, offers an easy setup, clean user interface, and automation tools to resolve customer queries efficiently.



### Motivation
Managing issues from our customers was a big challenge for us. We were using the ERPNext support module which was not very good in UI and the UX was also not good. We wanted to have a tool that can be easily integrated with our existing system and can be customized as per our needs. So we decided to build Frappe Helpdesk.

### Key Features

- **Agent and Customer Portal Views**: Dual portals for agents and customers to simplify issue submission and management.

- **Customizable SLAs**: Discover how you can set and track SLAs for better response times.

- **Assignment Rules**: Custom auto-assignment of tickets based on priority, issue type, or workload.

- **Knowledge Base**: Learn how to create and manage help articles to empower users and reduce tickets.

- **Canned Responses**: Pre-written replies for common queries to ensure quick and consistent communication.

<details open>
<summary >View Screenshots</summary>
<h3></h3>

<div align="center">
	<sub>
		Agent List View
	</sub>
</div>

![Agent List View](.github/AgentListView.png)


<div align="center">
	<sub>
		Upload articles and let your customer solve their queries through the Knowledge Base.
	</sub>
</div>

![Knowledge Base](.github/KB.png)

<div align="center">
	<sub>
		With advanced search, your customers will be recommended relevant articles regarding their issue.
	</sub>
</div>


![Article Search](.github/Search2.png)



</details>
<br>


### Under the Hood

- [**Frappe Framework**](https://github.com/frappe/frappe): A full-stack web application framework written in Python and Javascript.

- [**Frappe UI**](https://github.com/frappe/frappe-ui): A Vue-based UI library, to provide a modern user interface. 


## Production Setup

### Managed Hosting

You can try [Frappe Cloud](https://frappecloud.com), a simple, user-friendly and sophisticated [open-source](https://github.com/frappe/press) platform to host Frappe applications with peace of mind.

It takes care of installation, setup, upgrades, monitoring, maintenance and support of your Frappe deployments. It is a fully featured developer platform with an ability to manage and control multiple Frappe deployments.

<div>
	<a href="https://frappecloud.com/helpdesk/signup" target="_blank">
		<picture>
			<source media="(prefers-color-scheme: dark)" srcset="https://frappe.io/files/try-on-fc-white.png">
			<img src="https://frappe.io/files/try-on-fc-black.png" alt="Try on Frappe Cloud" height="28" />
		</picture>
	</a>
</div>

### Self Hosting

Follow these steps to set up Frappe Helpdesk in production:

**Step 1**: Download the easy install script

```bash
wget https://frappe.io/easy-install.py
```

**Step 2**: Run the deployment command

```bash
python3 ./easy-install.py deploy \
    --project=helpdesk_prod_setup \
    --email=your_email.example.com \
    --image=ghcr.io/frappe/helpdesk \
    --version=stable \
    --app=helpdesk \
    --sitename subdomain.domain.tld
```

Replace the following parameters with your values:
- `your_email.example.com`: Your email address
- `subdomain.domain.tld`: Your domain name where Helpdesk will be hosted

The script will set up a production-ready instance of Frappe Helpdesk with all the necessary configurations in about 5 minutes.

## Development Setup

### Docker

You need Docker, docker-compose and git setup on your machine. Refer [Docker documentation](https://docs.docker.com/). After that, follow below steps:

**Step 1**: Setup folder and download the required files

    mkdir frappe-helpdesk
    cd frappe-helpdesk

    # Download the docker-compose file
    wget -O docker-compose.yml https://raw.githubusercontent.com/frappe/helpdesk/develop/docker/docker-compose.yml

    # Download the setup script
    wget -O init.sh https://raw.githubusercontent.com/frappe/helpdesk/develop/docker/init.sh

**Step 2**: Run the container and daemonize it

    docker compose up -d

**Step 3**: The site [http://helpdesk.localhost:8000/helpdesk](http://helpdesk.localhost:8000/helpdesk) should now be available. The default credentials are:
- Username: Administrator
- Password: admin

### Local

To setup the repository locally follow the steps mentioned below:

1. Install bench and setup a `frappe-bench` directory by following the [Installation Steps](https://frappeframework.com/docs/user/en/installation)
1. Start the server by running `bench start`
1. In a separate terminal window, create a new site by running `bench new-site helpdesk.test`
1. Map your site to localhost with the command `bench --site helpdesk.test add-to-hosts`
1. Get the Helpdesk app. Run `bench get-app https://github.com/frappe/helpdesk`
1. Run `bench --site helpdesk.test install-app helpdesk`.
1. Now open the URL `http://helpdesk.test:8000/helpdesk` in your browser, you should see the app running


**For Frontend Development**
1. Open a new terminal session and cd into `frappe-bench/apps/helpdesk/desk`, and run the following commands:
    ```
    yarn install
    yarn dev or yarn dev --host helpdesk.test
    ```
1. Now, you can access the site on vite dev server at `http://helpdesk.test:8080`

**Note:** You'll find all the code related to Helpdesk's frontend inside `frappe-bench/apps/helpdesk/desk`

## Learn and connect

- [Telegram Public Group](https://t.me/frappedesk)
- [Discuss Forum](https://discuss.frappe.io/c/frappehelpdesk/69)
- [Documentation](https://docs.frappe.io/helpdesk)

<br>
<br>
<div align="center">
	<a href="https://frappe.io" target="_blank">
		<picture>
			<source media="(prefers-color-scheme: dark)" srcset="https://frappe.io/files/Frappe-white.png">
			<img src="https://frappe.io/files/Frappe-black.png" alt="Frappe Technologies" height="28"/>
		</picture>
	</a>
</div>
