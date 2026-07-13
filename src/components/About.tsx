// Statische Info-/About-Seite: erklärt allgemeinverständlich und aus Nutzersicht,
// was Superbilly ist, was man tun kann und wie die automatischen Syncs mit dem
// CRM (Zoho) und der Zeiterfassung (Mite) funktionieren. Rein statisch – keine
// Daten, kein State. Ziel: die App soll keine Blackbox sein.
export default function About() {
  return (
    <div className="about">
      <header className="about-hero">
        <h2 className="about-title">Über Superbilly</h2>
        <p className="about-lead">
          Superbilly ist die zentrale Planung fürs Consulting-Team: Es zeigt, <strong>wer wann an
          welchem Projekt arbeitet</strong>, und verbindet diese Planung mit den echten Zahlen aus
          unserem CRM und der Zeiterfassung. Damit ersetzt es die alte Excel-/Google-Docs-Liste –
          und alle schauen auf denselben, aktuellen Stand.
        </p>
      </header>

      <section className="about-sec">
        <h3 className="about-h">Was du hier tun kannst</h3>
        <div className="about-cards">
          <div className="about-card">
            <span className="about-card-tag">Billy</span>
            <p>
              Das <strong>Planungsraster</strong>. Hier buchst du Tage auf Projekte und siehst auf
              einen Blick, wer ausgelastet ist und wer noch frei hat. Überbuchungen werden rot
              markiert. Ein voller Tag zählt als 1, ein halber (z.&nbsp;B. zwei Kunden an einem Tag)
              als 0,5.
            </p>
          </div>
          <div className="about-card">
            <span className="about-card-tag">Projekte</span>
            <p>
              Alle Projekte mit Kunde, Budget, Zeitraum und Tagessatz. Von hier kommst du in die
              Detailansicht eines Projekts.
            </p>
          </div>
          <div className="about-card">
            <span className="about-card-tag">Neue Projekte</span>
            <p>
              Frisch aus dem CRM reingekommene und noch nicht verplante Projekte – die To-do-Liste
              fürs Verplanen. Der Unterbereich <strong>Pipeline-Forecast</strong> zeigt zusätzlich
              wahrscheinliche, noch nicht beauftragte Angebote als weiche Vorschau.
            </p>
          </div>
          <div className="about-card">
            <span className="about-card-tag">Meilensteine</span>
            <p>
              Die Rechnungs- und Zahlungstermine der Projekte über die kommenden Monate – inkl.
              Ampel für überfällige, noch offene Rechnungen.
            </p>
          </div>
          <div className="about-card">
            <span className="about-card-tag">Auswertung</span>
            <p>
              Auslastung, geplante vs. tatsächlich geleistete Tage (Soll/Ist) und Budget-Verbrauch –
              je Mitarbeiter, Projekt und Monat.
            </p>
          </div>
          <div className="about-card">
            <span className="about-card-tag">Verwaltung</span>
            <p>
              Nur für Admins: Mitarbeiter und Arbeitszeiten, System-Kategorien (Urlaub, Krank,
              Admin&nbsp;…), Zugriffsrechte und die Sync-Zuordnungen.
            </p>
          </div>
        </div>
      </section>

      <section className="about-sec">
        <h3 className="about-h">Woher die Daten kommen</h3>
        <p className="about-p">
          Vieles trägt sich <strong>von selbst</strong> ein. Zwei Systeme werden regelmäßig
          automatisch abgeglichen (und lassen sich jederzeit per Knopf sofort aktualisieren):
        </p>
        <div className="about-sync">
          <div className="about-sync-card">
            <div className="about-sync-head">
              <span className="about-sync-icon">📇</span>
              <h4>CRM (Zoho) → Projekte &amp; Rechnungen</h4>
            </div>
            <p>Aus dem CRM fließen die Aufträge automatisch als Projekte in Superbilly:</p>
            <ul>
              <li>
                <strong>Beauftragte Aufträge</strong> werden feste, buchbare Projekte.
              </li>
              <li>
                <strong>Offene Angebote</strong> (Angebot verschickt / nachgefasst / in Verhandlung)
                erscheinen als <strong>vorgemerkte Ressourcen</strong> – im Raster schraffiert. Du
                kannst sie schon verplanen, sie zählen aber noch nicht als feste Auslastung.
              </li>
              <li>
                Die <strong>Rechnungs-Meilensteine</strong> (Abgrenzungen) kommen ebenfalls aus dem
                CRM in die Meilenstein-Ansicht.
              </li>
            </ul>
            <p className="about-note">
              🔒 Aus dem CRM übernommene Angaben sind schreibgeschützt – der nächste Sync würde sie
              sonst wieder überschreiben. Änderungen macht man im CRM.
            </p>
          </div>

          <div className="about-sync-card">
            <div className="about-sync-head">
              <span className="about-sync-icon">⏱️</span>
              <h4>Zeiterfassung (Mite) → Ist-Zeiten</h4>
            </div>
            <p>
              Aus Mite fließen die <strong>tatsächlich erfassten Stunden</strong> automatisch als
              „Ist" auf die passenden Projekte. Daraus entstehen in der Auswertung:
            </p>
            <ul>
              <li>der Vergleich <strong>geplant vs. tatsächlich</strong> (Soll/Ist),</li>
              <li>der <strong>Budget-Verbrauch</strong> in Prozent,</li>
              <li>und der effektive Tagessatz.</li>
            </ul>
          </div>
        </div>
        <p className="about-p about-connect">
          <strong>Der Klebstoff:</strong> CRM-Auftrag, Projekt und Mite-Zeiten werden über die
          <strong> Angebotsnummer</strong> (z.&nbsp;B. <code>A&nbsp;-&nbsp;7821</code>) automatisch
          zusammengeführt. Passt eine Zuordnung ausnahmsweise nicht, lässt sie sich in der
          Verwaltung unter „Zuordnungen" von Hand korrigieren.
        </p>
      </section>

      <section className="about-sec">
        <h3 className="about-h">Automatisch vs. selbst gemacht</h3>
        <div className="about-split">
          <div className="about-split-col">
            <h4 className="about-split-h about-auto">Läuft automatisch</h4>
            <ul>
              <li>Projekte aus dem CRM anlegen &amp; aktualisieren</li>
              <li>Offene Angebote als vorgemerkte Ressourcen</li>
              <li>Rechnungs-Meilensteine aus dem CRM</li>
              <li>Ist-Zeiten aus Mite</li>
              <li>Feiertage aus der Kapazität herausrechnen</li>
            </ul>
          </div>
          <div className="about-split-col">
            <h4 className="about-split-h about-manual">Machst du selbst</h4>
            <ul>
              <li>Tage im Raster verplanen (wer, wann, welches Projekt)</li>
              <li>Meilenstein-Status pflegen (offen → gestellt → bezahlt)</li>
              <li>Urlaub / Krank / Frei eintragen</li>
              <li>In Ausnahmefällen Zuordnungen korrigieren</li>
            </ul>
          </div>
        </div>
      </section>

      <p className="about-foot">
        Kurz gesagt: Superbilly nimmt dir die Fleißarbeit ab und hält CRM, Zeiterfassung und Planung
        zusammen – damit du dich aufs Verplanen konzentrieren kannst und alle Zahlen an einer Stelle
        stimmen.
      </p>
    </div>
  )
}
