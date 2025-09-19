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

// Map disease dropdown names -> ontology individuals (object property targets)
const diseaseMap = {
  "Rice Blast": ":Rice_Blast",
  "False Smut": ":False_Smut",
  "Sheath Blight": ":Sheath_Blight",
  "Bacterial Leaf Blight": ":Bacterial_Leaf_Blight",
  "Sheath Rot": ":Sheath_Rot"
};

// Map location names -> Location individuals in ontology
const locationMap = {
  "Ampara": ":Ampara",
  "Anuradhapura": ":Anuradhapura",
  "Badulla": ":Badulla",
  "Battiocaloa": ":Battiocaloa",
  "Colombo": ":Colombo",
  "Galle": ":Galle",
  "Gampaha": ":Gampaha",
  "Hambantota": ":Hambantota",
  "Jaffna": ":Jaffna",
  "Kalutara": ":Kalutara",
  "Kandy": ":Kandy",
  "Kilinochchi": ":Kilinochchi",
  "Kurunegala": ":Kurunegala",
  "Mannar": ":Mannar",
  "Matale": ":Matale",
  "Monaragala": ":Monaragala",
  "Mullaitivu": ":Mullaitivu",
  "Polonnaruwa": ":Polonnaruwa",
  "Puttalam": ":Puttalam",
  "Rathnapura": ":Rathnapura",
  "Trincomalee": ":Trincomalee",
  "Vavuniya": ":Vavuniya"
};

// Helper to post SPARQL Update
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

// Helper to query (SELECT) and return JSON bindings
async function sparqlQuery(query) {
  const url = SPARQL_QUERY_URL + "?query=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { Accept: "application/sparql-results+json" }});
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("SPARQL Query failed: " + res.status + " " + txt);
  }
  return res.json();
}

// Insert user input and link to disease & location individuals
async function insertUserInput(diseaseName, budget, locationName, control) {
  const diseaseLocal = diseaseMap[diseaseName]; // e.g., ":Rice_Blast"
  if (!diseaseLocal) throw new Error("Unknown disease: " + diseaseName);

  const locationLocal = locationMap[locationName]; // e.g., ":Kalutara"
  if (!locationLocal) throw new Error("Unknown location: " + locationName);

  const id = `UserInput_${Date.now()}`;
  const instance = `:${id}`;

  // Remove previous transient flags
  const clearTreatments = `
PREFIX : <${ONTO}>
DELETE {
  ?t :priority ?p ;
     :isAffordable ?aff ;
     :isControlMethodSuitable ?cms ;
     :isSuitable ?suit ;
     :hasPrimarySource ?ps ;
     :isSpecific ?isSpec .
}
WHERE {
  ?t a :Treatments .
  OPTIONAL { ?t :priority ?p }
  OPTIONAL { ?t :isAffordable ?aff }
  OPTIONAL { ?t :isControlMethodSuitable ?cms }
  OPTIONAL { ?t :isSuitable ?suit }
  OPTIONAL { ?t :hasPrimarySource ?ps }
  OPTIONAL { ?t :isSpecific ?isSpec }
}`;
  await sparqlUpdate(clearTreatments);

  // Insert user input
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



/* ---------- RULES AS SPARQL UPDATES (applied per user instance) ----------
   I kept your budget rule logic unchanged (exactly as you required).
   I only replaced uses of :hasLocation with :hasLocationName where we
   need to follow the actual link inserted above.
----------------------------------------------------------------------- */

async function applyBudgetRulesForUser(userId) {
  const userIRI = `:${userId}`;
  const prefix = `PREFIX : <${ONTO}>\nPREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n`;

  // HIGH: budget >= cost -> priority "High"
  const high = `
${prefix}
INSERT {
  ?t :priority "High" .
}
WHERE {
  ${userIRI} :hasUserBudget ?budget .
  ?t a :Treatments ; :hasCost ?cost .
  FILTER( xsd:decimal(?budget) >= xsd:decimal(?cost) )
}`;

  // MEDIUM: cost > budget && cost <= budget*1.2
  const medium = `
${prefix}
INSERT {
  ?t :priority "Medium" .
}
WHERE {
  ${userIRI} :hasUserBudget ?budget .
  ?t a :Treatments ; :hasCost ?cost .
  BIND( xsd:decimal(?budget) * 1.2 AS ?budget120 )
  FILTER( xsd:decimal(?cost) > xsd:decimal(?budget) && xsd:decimal(?cost) <= xsd:decimal(?budget120) )
}`;

  // LOW: cost > budget120 && cost <= budget150
  const low = `
${prefix}
INSERT {
  ?t :priority "Low" .
}
WHERE {
  ${userIRI} :hasUserBudget ?budget .
  ?t a :Treatments ; :hasCost ?cost .
  BIND( xsd:decimal(?budget) * 1.2 AS ?budget120 )
  BIND( xsd:decimal(?budget) * 1.5 AS ?budget150 )
  FILTER( xsd:decimal(?cost) > xsd:decimal(?budget120) && xsd:decimal(?cost) <= xsd:decimal(?budget150) )
}`;

  // NOT AFFORDABLE: cost > budget150 -> isAffordable false
  const notAffordable = `
${prefix}
INSERT {
  ?t :isAffordable "false" .
}
WHERE {
  ${userIRI} :hasUserBudget ?budget .
  ?t a :Treatments ; :hasCost ?cost .
  BIND( xsd:decimal(?budget) * 1.5 AS ?budget150 )
  FILTER( xsd:decimal(?cost) > xsd:decimal(?budget150) )
}`;

  // AFFORDABLE true for High/Medium/Low priorities
  const affordableFromPriority = `
${prefix}
INSERT {
  ?t :isAffordable true .
}
WHERE {
  ?t a :Treatments ;
     :priority ?pr .
  FILTER( ?pr = "High" || ?pr = "Medium" || ?pr = "Low" )
}`;

  await sparqlUpdate(high);
  await sparqlUpdate(medium);
  await sparqlUpdate(low);
  await sparqlUpdate(notAffordable);
  await sparqlUpdate(affordableFromPriority);
}

async function applyControlMethodAndSuitabilityRules(userId) {
  const userIRI = `:${userId}`;
  const prefix = `PREFIX : <${ONTO}>\nPREFIX fn: <http://www.w3.org/2005/xpath-functions#>\n`;

  // 9: isControlMethodSuitable: match user's hasControlMethodInput (case-insensitive) with control method's hasMethod
  const controlSuitable = `
${prefix}
INSERT {
  ?t :isControlMethodSuitable true .
}
WHERE {
  ${userIRI} :hasControlMethodInput ?inputMethod ;
             :hasDiseasec ?disease .
  ?disease :hasControlMethods ?cm .
  ?cm :hasMethod ?methodType .
  ?cm :hasTreatments ?t .
  FILTER(lcase(str(?inputMethod)) = lcase(str(?methodType)))
}`;

  // 10: isSuitable if isAffordable true AND isControlMethodSuitable true
  const isSuitable = `
${prefix}
INSERT {
  ?t :isSuitable true .
}
WHERE {
  ?t a :Treatments ;
     :isAffordable true ;
     :isControlMethodSuitable true .
}`;

  await sparqlUpdate(controlSuitable);
  await sparqlUpdate(isSuitable);
}

async function applyPrimarySourceRules(userId) {
  const userIRI = `:${userId}`;
  const prefix = `PREFIX : <${ONTO}>\nPREFIX fn: <http://www.w3.org/2005/xpath-functions#>\n`;

  // rule 5 - False Smut + location humidity VeryHigh + temp Optimal + rainfall High
  const r5 = `
${prefix}
INSERT {
  ?d :hasPrimarySource "Chlamydospores & Sclerotia (soil)" .
}
WHERE {
  ${userIRI} :hasDiseasec ?d ;
            :hasLocationName ?loc .
  ?loc :hasHumidity_L "VeryHigh" ;
       :hasTemperatureRange "Optimal" ;
       :hasRainfallPattern_L "High" .
  ?d a :Disease .
  ?d :hasName ?dname .
  FILTER(lcase(str(?dname)) = "false smut")
}`;

  // rule 6 - Rice Blast airborne spores: location.humidity high & rainfall veryHigh
  const r6 = `
${prefix}
INSERT {
  ?d :hasPrimarySource "Airborne Spores" .
}
WHERE {
  ${userIRI} :hasLocationName ?loc ;
            :hasDiseasec ?d .
  ?loc :hasHumidity_L ?h ;
       :hasRainfallPattern_L ?rain .
  ?d :hasName ?dname .
  FILTER( lcase(str(?h)) = "high" && lcase(str(?rain)) = "veryhigh" && lcase(str(?dname)) = "rice blast")
}`;

  // rule 7 - Rice Blast infected seeds when rainfall = High
  const r7 = `
${prefix}
INSERT {
  ?d :hasPrimarySource "Infected Seeds" .
}
WHERE {
  ${userIRI} :hasLocationName ?loc ;
            :hasDiseasec ?d .
  ?loc :hasRainfallPattern_L ?rain .
  ?d :hasName ?dname .
  FILTER( lcase(str(?rain)) = "high" && lcase(str(?dname)) = "rice blast")
}`;

  // rule 8 - Rice Blast soil and water when rainfall veryHigh and soil moisture High
  const r8 = `
${prefix}
INSERT {
  ?d :hasPrimarySource "Soil and Water" .
}
WHERE {
  ${userIRI} :hasLocationName ?loc ;
            :hasDiseasec ?d .
  ?loc :hasRainfallPattern_L ?rain ;
       :hasSoilMoisture_L ?moist .
  ?d :hasName ?dname .
  FILTER( lcase(str(?rain)) = "veryhigh" && lcase(str(?moist)) = "high" && lcase(str(?dname)) = "rice blast")
}`;

  // rule 15 (duplicated form)
  const r15 = `
${prefix}
INSERT {
  ?d :hasPrimarySource "Airborne Spores" .
}
WHERE {
  ${userIRI} :hasLocationName ?loc ;
            :hasDiseasec ?d .
  ?loc :hasHumidity ?h ;
       :hasRainfallPattern ?rain .
  ?d :hasName ?dname .
  FILTER( lcase(str(?h)) = "high" && lcase(str(?rain)) = "veryhigh" && lcase(str(?dname)) = "rice blast")
}`;

  // run all
  await sparqlUpdate(r5);
  await sparqlUpdate(r6);
  await sparqlUpdate(r7);
  await sparqlUpdate(r8);
  await sparqlUpdate(r15);
}

async function applySymptomSpecificRule(userId) {
  const userIRI = `:${userId}`;
  const prefix = `PREFIX : <${ONTO}>\nPREFIX fn: <http://www.w3.org/2005/xpath-functions#>\n`;

  // rule 11/isSpecific: match user location's env features to symptom env features
  const rule11 = `
${prefix}
INSERT {
  ?sym :isSpecific "true" .
}
WHERE {
  ${userIRI} :hasLocationName ?loc ;
            :hasDiseasec ?d .
  ?loc :hasTemperatureRange ?tempL ;
       :hasHumidity_L ?humL ;
       :hasSoilMoisture_L ?soilL ;
       :hasLightIntensity_L ?lightL ;
       :hasRainfallPattern_L ?rainL .
  ?d :hasSymptomps ?sym .
  ?sym :AreAffectedBy ?env .
  ?env :hasTemperatureRange_symp ?tempE ;
       :hasHumidity ?humE ;
       :hasSoilMoisture ?soilE ;
       :hasLightIntensity ?lightE ;
       :hasRainfallPattern ?rainE .
  FILTER( lcase(str(?tempL)) = lcase(str(?tempE)) &&
          lcase(str(?humL)) = lcase(str(?humE)) &&
          lcase(str(?soilL)) = lcase(str(?soilE)) &&
          lcase(str(?lightL)) = lcase(str(?lightE)) &&
          lcase(str(?rainL)) = lcase(str(?rainE)) )
}`;
  await sparqlUpdate(rule11);
}

// convenience: run all rule application steps for a user
async function runAllRulesForUser(userId) {
  await applyBudgetRulesForUser(userId);
  await applyControlMethodAndSuitabilityRules(userId);
  await applyPrimarySourceRules(userId);
  await applySymptomSpecificRule(userId);
}

/* ------------------ HTTP Endpoints ------------------ */

// POST submit-input -> create user, run rules
app.post("/submit-input", async (req, res) => {
  try {
    const { disease, budget, location, controlMethod } = req.body;
    if (!disease || !budget || !location) {
      return res.status(400).json({ error: "disease, budget and location are required" });
    }

    const instanceId = await insertUserInput(disease, budget, location, controlMethod || "");

    // apply rules (SPARQL updates) for this user instance
    await runAllRulesForUser(instanceId);

    res.json({ success: true, instance: instanceId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET disease-agent/:disease
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

// GET disease-symptoms/:disease
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

    const response = await fetch(
      SPARQL_QUERY_URL + "?query=" + encodeURIComponent(query),
      { headers: { Accept: "application/sparql-results+json" } }
    );

    const data = await response.json();
    res.json(data.results.bindings);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// GET disease-environment/:disease
app.get("/disease-environment/:disease", async (req, res) => {
  try {
    const disease = req.params.disease;
    const q = `
PREFIX : <${ONTO}>
SELECT ?temperature ?humidity ?soilMoisture ?rainfallPattern
WHERE {
  ?disease a :Disease ;
           :hasName ?name ;
           :getAffectedBy ?envCondition .
  ?envCondition :hasTemperatureRange_ec ?temperature ;
                :hasHumidity_ec ?humidity ;
                :hasSoilMoisture_ec ?soilMoisture ;
                :hasRainfallPattern_ec ?rainfallPattern .
  FILTER (STR(?name) = "${disease}")
}`;
    const data = await sparqlQuery(q);
    res.json(data.results.bindings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /user/:userId/treatments
// GET /user/:userId/r-treatments-suitable
app.get("/user/:userId/r-treatments-suitable", async (req, res) => {
  try {
    const userId = req.params.userId;

    const query = `
      PREFIX : <${ONTO}>
      SELECT ?controlMethod ?productName ?treatment ?effectiveness ?environmentImpact
             ?impact ?condition
             (GROUP_CONCAT(DISTINCT ?safetyMeasures; separator=", ") AS ?allSafetyMeasures)
             (GROUP_CONCAT(DISTINCT ?instructions; separator=", ") AS ?allInstructions)
             (GROUP_CONCAT(DISTINCT ?applicationFrequency; separator=", ") AS ?allApplicationFrequencies)
      WHERE {
        :${userId} :hasDiseasec ?disease .

        ?disease :hasControlMethods ?controlMethod .
        ?controlMethod :hasTreatmentStatus "R" ;
                       :hasProductName ?productName ;
                       :hasTreatments ?treatment .

        ?treatment :isControlMethodSuitable true .

        OPTIONAL { ?treatment :Effectiveness ?effectiveness }
        OPTIONAL { ?treatment :EnvironmentImpact ?environmentImpact }
        OPTIONAL { ?treatment :hasImpact ?impact }
        OPTIONAL { ?treatment :hasCondtion ?condition }

        OPTIONAL {
          ?treatment :hasUserGuidelines ?guidelines .
          OPTIONAL { ?guidelines :hasSafetyMeasures ?safetyMeasures }
          OPTIONAL { ?guidelines :hasInstruction ?instructions }
          OPTIONAL { ?guidelines :hasApplicationFrequency ?applicationFrequency }
        }
      }
      GROUP BY ?controlMethod ?productName ?treatment ?effectiveness ?environmentImpact ?impact ?condition
    `;

    const response = await fetch(
      SPARQL_QUERY_URL + "?query=" + encodeURIComponent(query),
      { headers: { Accept: "application/sparql-results+json" } }
    );

    const data = await response.json();
    res.json(data.results.bindings);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// GET /user/:userId/general-treatments
// GET /user/:userId/general-treatments
app.get("/user/:userId/general-treatments", async (req, res) => {
  try {
    const userId = req.params.userId;

    const query = `
      PREFIX : <${ONTO}>
      SELECT ?treatment ?controlMethodName ?methodDescription ?activeIngredient
             ?effectiveness ?environmentImpactVal ?impactVal ?conditionVal
             (GROUP_CONCAT(DISTINCT ?safetyMeasures; separator=", ") AS ?safetyMeasuresVal)
             (GROUP_CONCAT(DISTINCT ?instructions; separator=", ") AS ?instructionsVal)
             (GROUP_CONCAT(DISTINCT ?applicationFrequency; separator=", ") AS ?applicationFrequencyVal)
      WHERE {
        :${userId} :hasDiseasec ?disease .

        ?disease :hasControlMethods ?controlMethod .
        ?controlMethod :hasTreatmentStatus "P" ;
                       :hasProductName ?controlMethodName ;
                       :hasTreatments ?treatment .

        ?treatment :isControlMethodSuitable true ;
                   :Effectiveness ?effectiveness .

        OPTIONAL { ?controlMethod :hasDescription ?methodDescription }
        OPTIONAL { ?controlMethod :hasActiveIngredient ?activeIngredient }
        OPTIONAL { ?treatment :EnvironmentImpact ?environmentImpact }
        OPTIONAL { ?treatment :hasImpact ?impact }
        OPTIONAL { ?treatment :hasCondtion ?condition }

        OPTIONAL { ?treatment :hasUserGuidelines ?userGuidelines }
        OPTIONAL { ?userGuidelines :hasSafetyMeasures ?safetyMeasures }
        OPTIONAL { ?userGuidelines :hasInstruction ?instructions }
        OPTIONAL { ?userGuidelines :hasApplicationFrequency ?applicationFrequency }

        BIND(IF(BOUND(?environmentImpact), ?environmentImpact, "No environment impact") AS ?environmentImpactVal)
        BIND(IF(BOUND(?impact), ?impact, "No impact") AS ?impactVal)
        BIND(IF(BOUND(?condition), ?condition, "No condition") AS ?conditionVal)
      }
      GROUP BY ?treatment ?controlMethodName ?methodDescription ?activeIngredient
               ?effectiveness ?environmentImpactVal ?impactVal ?conditionVal
    `;

    const response = await fetch(
      SPARQL_QUERY_URL + "?query=" + encodeURIComponent(query),
      { headers: { Accept: "application/sparql-results+json" } }
    );

    const data = await response.json();
    res.json(data.results.bindings);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /general-guidelines
app.get("/general-guidelines", async (req, res) => {
  try {
    const query = `
      PREFIX : <${ONTO}>
      SELECT ?guidelineName ?gDescription ?guideline
      WHERE {
        ?guidelineName a :GeneralGuideline .
        OPTIONAL { ?guidelineName :GDescription ?gDescription }
        OPTIONAL { ?guidelineName :Guideline ?guideline }
      }
    `;

    const response = await fetch(SPARQL_QUERY_URL + "?query=" + encodeURIComponent(query), {
      headers: { Accept: "application/sparql-results+json" }
    });

    const data = await response.json();
    res.json(data.results.bindings);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// start server
app.listen(3001, () => console.log("Ontology backend running on port 3001"));
