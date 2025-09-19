// index.js
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// SPARQL endpoint URLs (Fuseki dataset)
const SPARQL_UPDATE_URL = "http://localhost:3030/paddyKBS/update";
const SPARQL_QUERY_URL = "http://localhost:3030/paddyKBS/query";

const ONTO = "http://www.semanticweb.org/veranga/ontologies/2025/5/Knowledge_Based_System_Version_5#";

// Map disease dropdown names -> ontology individuals
const diseaseMap = {
  "Rice Blast": ":Rice_Blast",
  "False Smut": ":False_Smut",
  "Sheath Blight": ":Sheath_Blight",
  "Bacterial Leaf Blight": ":Bacterial_Leaf_Blight",
  "Sheath Rot": ":Sheath_Rot"
};

// Map location names -> ontology individuals
const locationMap = {
  "Ampara": ":Ampara", "Anuradhapura": ":Anuradhapura", "Badulla": ":Badulla",
  "Battiocaloa": ":Battiocaloa", "Colombo": ":Colombo", "Galle": ":Galle",
  "Gampaha": ":Gampaha", "Hambantota": ":Hambantota", "Jaffna": ":Jaffna",
  "Kalutara": ":Kalutara", "Kandy": ":Kandy", "Kilinochchi": ":Kilinochchi",
  "Kurunegala": ":Kurunegala", "Mannar": ":Mannar", "Matale": ":Matale",
  "Monaragala": ":Monaragala", "Mullaitivu": ":Mullaitivu", "Polonnaruwa": ":Polonnaruwa",
  "Puttalam": ":Puttalam", "Rathnapura": ":Rathnapura", "Trincomalee": ":Trincomalee",
  "Vavuniya": ":Vavuniya"
};

// Helper: SPARQL Update
async function sparqlUpdate(update) {
  const res = await fetch(SPARQL_UPDATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/sparql-update" },
    body: update
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("SPARQL Update failed: " + res.status + " " + txt);
  }
  return true;
}

// Helper: SPARQL Query
async function sparqlQuery(query) {
  const url = SPARQL_QUERY_URL + "?query=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { Accept: "application/sparql-results+json" } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("SPARQL Query failed: " + res.status + " " + txt);
  }
  return res.json();
}

// Insert user input
async function insertUserInput(diseaseName, budget, locationName, control) {
  const diseaseLocal = diseaseMap[diseaseName];
  if (!diseaseLocal) throw new Error("Unknown disease: " + diseaseName);
  const locationLocal = locationMap[locationName];
  if (!locationLocal) throw new Error("Unknown location: " + locationName);

  const id = `UserInput_${Date.now()}`;
  const instance = `:${id}`;

  // Clear previous transient flags
  const clearTreatments = `
PREFIX : <${ONTO}>
DELETE { ?t :priority ?p ; :isAffordable ?aff ; :isControlMethodSuitable ?cms ; :isSuitable ?suit ; :hasPrimarySource ?ps ; :isSpecific ?isSpec . }
WHERE { ?t a :Treatments . OPTIONAL { ?t :priority ?p } OPTIONAL { ?t :isAffordable ?aff } OPTIONAL { ?t :isControlMethodSuitable ?cms } OPTIONAL { ?t :isSuitable ?suit } OPTIONAL { ?t :hasPrimarySource ?ps } OPTIONAL { ?t :isSpecific ?isSpec } }`;
  await sparqlUpdate(clearTreatments);

  const insertUser = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX : <${ONTO}>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
INSERT DATA {
  ${instance} rdf:type :User_Inputs ;
              :hasDiseasec ${diseaseLocal} ;
              :hasLocationName ${locationLocal} ;
              :hasUserBudget "${budget}"^^xsd:decimal ;
              :hasControlMethodInput "${control}" .
}`;
  await sparqlUpdate(insertUser);

  return id;
}

// -------------------- RULE FUNCTIONS --------------------

// Apply budget rules
async function applyBudgetRulesForUser(userId) {
  const userIRI = `:${userId}`;
  const prefix = `PREFIX : <${ONTO}>\nPREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n`;

  const high = `${prefix} INSERT { ?t :priority "High" } WHERE { ${userIRI} :hasUserBudget ?budget . ?t a :Treatments ; :hasCost ?cost . FILTER( xsd:decimal(?budget) >= xsd:decimal(?cost) ) }`;
  const medium = `${prefix} INSERT { ?t :priority "Medium" } WHERE { ${userIRI} :hasUserBudget ?budget . ?t a :Treatments ; :hasCost ?cost . BIND( xsd:decimal(?budget) * 1.2 AS ?budget120 ) FILTER( xsd:decimal(?cost) > xsd:decimal(?budget) && xsd:decimal(?cost) <= xsd:decimal(?budget120) ) }`;
  const low = `${prefix} INSERT { ?t :priority "Low" } WHERE { ${userIRI} :hasUserBudget ?budget . ?t a :Treatments ; :hasCost ?cost . BIND( xsd:decimal(?budget) * 1.2 AS ?budget120 ) BIND( xsd:decimal(?budget) * 1.5 AS ?budget150 ) FILTER( xsd:decimal(?cost) > xsd:decimal(?budget120) && xsd:decimal(?cost) <= xsd:decimal(?budget150) ) }`;
  const notAffordable = `${prefix} INSERT { ?t :isAffordable "false" } WHERE { ${userIRI} :hasUserBudget ?budget . ?t a :Treatments ; :hasCost ?cost . BIND( xsd:decimal(?budget) * 1.5 AS ?budget150 ) FILTER( xsd:decimal(?cost) > xsd:decimal(?budget150) ) }`;
  const affordableFromPriority = `${prefix} INSERT { ?t :isAffordable true } WHERE { ?t a :Treatments ; :priority ?pr . FILTER( ?pr = "High" || ?pr = "Medium" || ?pr = "Low" ) }`;

  await sparqlUpdate(high);
  await sparqlUpdate(medium);
  await sparqlUpdate(low);
  await sparqlUpdate(notAffordable);
  await sparqlUpdate(affordableFromPriority);
}

// Control method & suitability
async function applyControlMethodAndSuitabilityRules(userId) {
  const userIRI = `:${userId}`;
  const prefix = `PREFIX : <${ONTO}>\nPREFIX fn: <http://www.w3.org/2005/xpath-functions#>\n`;

  const controlSuitable = `${prefix} INSERT { ?t :isControlMethodSuitable true } WHERE { ${userIRI} :hasControlMethodInput ?inputMethod ; :hasDiseasec ?disease . ?disease :hasControlMethods ?cm . ?cm :hasMethod ?methodType . ?cm :hasTreatments ?t . FILTER(lcase(str(?inputMethod)) = lcase(str(?methodType))) }`;
  const isSuitable = `${prefix} INSERT { ?t :isSuitable true } WHERE { ?t a :Treatments ; :isAffordable true ; :isControlMethodSuitable true . }`;

  await sparqlUpdate(controlSuitable);
  await sparqlUpdate(isSuitable);
}

// Primary source rules
async function applyPrimarySourceRules(userId) {
  const userIRI = `:${userId}`;
  const prefix = `PREFIX : <${ONTO}>\nPREFIX fn: <http://www.w3.org/2005/xpath-functions#>\n`;

  const r5 = `${prefix} INSERT { ?d :hasPrimarySource "Chlamydospores & Sclerotia (soil)" } WHERE { ${userIRI} :hasDiseasec ?d ; :hasLocationName ?loc . ?loc :hasHumidity_L "VeryHigh" ; :hasTemperatureRange "Optimal" ; :hasRainfallPattern_L "High" . ?d a :Disease ; :hasName ?dname . FILTER(lcase(str(?dname)) = "false smut") }`;
  const r6 = `${prefix} INSERT { ?d :hasPrimarySource "Airborne Spores" } WHERE { ${userIRI} :hasLocationName ?loc ; :hasDiseasec ?d . ?loc :hasHumidity_L ?h ; :hasRainfallPattern_L ?rain . ?d :hasName ?dname . FILTER( lcase(str(?h)) = "high" && lcase(str(?rain)) = "veryhigh" && lcase(str(?dname)) = "rice blast") }`;
  const r7 = `${prefix} INSERT { ?d :hasPrimarySource "Infected Seeds" } WHERE { ${userIRI} :hasLocationName ?loc ; :hasDiseasec ?d . ?loc :hasRainfallPattern_L ?rain . ?d :hasName ?dname . FILTER( lcase(str(?rain)) = "high" && lcase(str(?dname)) = "rice blast") }`;
  const r8 = `${prefix} INSERT { ?d :hasPrimarySource "Soil and Water" } WHERE { ${userIRI} :hasLocationName ?loc ; :hasDiseasec ?d . ?loc :hasRainfallPattern_L ?rain ; :hasSoilMoisture_L ?moist . ?d :hasName ?dname . FILTER( lcase(str(?rain)) = "veryhigh" && lcase(str(?moist)) = "high" && lcase(str(?dname)) = "rice blast") }`;
  const r15 = `${prefix} INSERT { ?d :hasPrimarySource "Airborne Spores" } WHERE { ${userIRI} :hasLocationName ?loc ; :hasDiseasec ?d . ?loc :hasHumidity ?h ; :hasRainfallPattern ?rain . ?d :hasName ?dname . FILTER( lcase(str(?h)) = "high" && lcase(str(?rain)) = "veryhigh" && lcase(str(?dname)) = "rice blast") }`;

  await sparqlUpdate(r5);
  await sparqlUpdate(r6);
  await sparqlUpdate(r7);
  await sparqlUpdate(r8);
  await sparqlUpdate(r15);
}

// Symptom-specific rule
async function applySymptomSpecificRule(userId) {
  const userIRI = `:${userId}`;
  const prefix = `PREFIX : <${ONTO}>\nPREFIX fn: <http://www.w3.org/2005/xpath-functions#>\n`;

  const rule11 = `${prefix} INSERT { ?sym :isSpecific "true" } WHERE { ${userIRI} :hasLocationName ?loc ; :hasDiseasec ?d . ?loc :hasTemperatureRange ?tempL ; :hasHumidity_L ?humL ; :hasSoilMoisture_L ?soilL ; :hasLightIntensity_L ?lightL ; :hasRainfallPattern_L ?rainL . ?d :hasSymptomps ?sym . ?sym :AreAffectedBy ?env . ?env :hasTemperatureRange_symp ?tempE ; :hasHumidity ?humE ; :hasSoilMoisture ?soilE ; :hasLightIntensity ?lightE ; :hasRainfallPattern ?rainE . FILTER( lcase(str(?tempL)) = lcase(str(?tempE)) && lcase(str(?humL)) = lcase(str(?humE)) && lcase(str(?soilL)) = lcase(str(?soilE)) && lcase(str(?lightL)) = lcase(str(?lightE)) && lcase(str(?rainL)) = lcase(str(?rainE)) ) }`;
  
  await sparqlUpdate(rule11);
}

// Run all rules
async function runAllRulesForUser(userId) {
  await applyBudgetRulesForUser(userId);
  await applyControlMethodAndSuitabilityRules(userId);
  await applyPrimarySourceRules(userId);
  await applySymptomSpecificRule(userId);
}

// -------------------- ENDPOINTS --------------------

// Submit user input
app.post("/submit-input", async (req, res) => {
  try {
    const { disease, budget, location, controlMethod } = req.body;
    if (!disease || !budget || !location) {
      return res.status(400).json({ error: "disease, budget and location are required" });
    }
    const instanceId = await insertUserInput(disease, budget, location, controlMethod || "");
    await runAllRulesForUser(instanceId);
    res.json({ success: true, instance: instanceId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get disease agent
app.get("/disease-agent/:disease", async (req, res) => {
  try {
    const disease = req.params.disease;
    const q = `
PREFIX : <${ONTO}>
SELECT DISTINCT ?scientificName ?type
WHERE {
  ?disease a :Disease ;
           :hasName ?name ;
           :causedBy ?agent .
  ?agent :hasScientificName ?scientificName ;
         :hasType ?type .
  FILTER regex(str(?name), "^${disease}$", "i")
}`;
    const data = await sparqlQuery(q);
    res.json(data.results.bindings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user disease details
app.get("/user/:userId/disease-details", async (req, res) => {
  try {
    const userId = req.params.userId;
    const query = `
PREFIX : <${ONTO}>
SELECT ?disease ?diseaseName ?overallSymptoms ?primarySource
       (GROUP_CONCAT(DISTINCT ?symptomDescription; separator=", ") AS ?symptomDescriptions)
       (GROUP_CONCAT(DISTINCT ?hasAffectedParts; separator=", ") AS ?affectedParts)
       (GROUP_CONCAT(DISTINCT ?symptom; separator=", ") AS ?symptoms)
WHERE {
  :${userId} :hasDiseasec ?disease .
  OPTIONAL { ?disease :hasName ?diseaseName }
  OPTIONAL { ?disease :hasOverallSymptopms ?overallSymptoms }
  OPTIONAL { ?disease :hasPrimarySource ?primarySource }
  OPTIONAL { 
    ?disease :hasSymptoms ?symptom .
    ?symptom :isSpecific ?isSpecific .
    FILTER(?isSpecific = true)
    OPTIONAL { ?symptom :symptomDescription ?symptomDescription }
    OPTIONAL { ?symptom :hasAffectedParts ?hasAffectedParts }
  }
}
GROUP BY ?disease ?diseaseName ?overallSymptoms ?primarySource
`;
    const data = await sparqlQuery(query);
    res.json(data.results.bindings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ontology backend running on port ${PORT}`));
