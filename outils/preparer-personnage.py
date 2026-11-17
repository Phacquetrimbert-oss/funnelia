"""Prépare un personnage glTF (.glb) pour Funnelia.

1. Ne garde que les animations utiles au bureau (les autres sont retirées du fichier).
2. Reconstruit le tampon binaire sans les données devenues inutiles.
3. Écrit le .glb allégé et un .js qui le contient en base64 : le jeu le charge avec
   une simple balise <script>, ce qui fonctionne en double-cliquant sur index.html (file://).

Usage : python3 outils/preparer-personnage.py <source.glb> <nom> <anim1,anim2,...>
Exemple : python3 outils/preparer-personnage.py assets/personnages/sources/homme-costume.glb homme-costume Idle,Sitting,Standing,Walk,Clapping
"""
import base64, json, struct, sys

source, nom, gardees = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
octets = open(source, "rb").read()
long_json = struct.unpack("<I", octets[12:16])[0]
gltf = json.loads(octets[20:20 + long_json])
bin_debut = 20 + long_json + 8
binaire = octets[bin_debut:]

# 1. Animations conservées (comparaison sur la fin du nom : "HumanArmature|Man_Idle" -> "Idle")
gltf["animations"] = [a for a in gltf.get("animations", []) if a["name"].split("_")[-1] in gardees]
for a in gltf["animations"]:
    a["name"] = a["name"].split("_")[-1]

# 2. Accessors encore référencés
utilises = set()
def noter(i):
    if i is not None: utilises.add(i)
for m in gltf["meshes"]:
    for p in m["primitives"]:
        noter(p.get("indices"))
        for v in p["attributes"].values(): noter(v)
        for cible in p.get("targets", []):
            for v in cible.values(): noter(v)
for s in gltf.get("skins", []): noter(s.get("inverseBindMatrices"))
for a in gltf["animations"]:
    for e in a["samplers"]: noter(e["input"]); noter(e["output"])

ancien_vers_nouveau, accessors = {}, []
for i, acc in enumerate(gltf["accessors"]):
    if i in utilises:
        ancien_vers_nouveau[i] = len(accessors); accessors.append(acc)
def renum(i): return ancien_vers_nouveau[i]
for m in gltf["meshes"]:
    for p in m["primitives"]:
        if "indices" in p: p["indices"] = renum(p["indices"])
        p["attributes"] = {k: renum(v) for k, v in p["attributes"].items()}
        if "targets" in p: p["targets"] = [{k: renum(v) for k, v in c.items()} for c in p["targets"]]
for s in gltf.get("skins", []):
    if "inverseBindMatrices" in s: s["inverseBindMatrices"] = renum(s["inverseBindMatrices"])
for a in gltf["animations"]:
    for e in a["samplers"]: e["input"] = renum(e["input"]); e["output"] = renum(e["output"])
gltf["accessors"] = accessors

# 3. bufferViews utilisés, recopiés dans un nouveau tampon (alignement 4 octets)
vues_utilisees = sorted({acc["bufferView"] for acc in accessors if "bufferView" in acc})
nouveau, vues, correspondance = bytearray(), [], {}
for i in vues_utilisees:
    v = dict(gltf["bufferViews"][i])
    debut = v.get("byteOffset", 0)
    while len(nouveau) % 4: nouveau.append(0)
    v["byteOffset"] = len(nouveau)
    nouveau += binaire[debut:debut + v["byteLength"]]
    correspondance[i] = len(vues); vues.append(v)
for acc in accessors:
    if "bufferView" in acc: acc["bufferView"] = correspondance[acc["bufferView"]]
gltf["bufferViews"] = vues
while len(nouveau) % 4: nouveau.append(0)
gltf["buffers"] = [{"byteLength": len(nouveau)}]

texte = json.dumps(gltf, separators=(",", ":")).encode()
while len(texte) % 4: texte += b" "
glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(texte) + 8 + len(nouveau))
glb += struct.pack("<II", len(texte), 0x4E4F534A) + texte + struct.pack("<II", len(nouveau), 0x004E4942) + bytes(nouveau)

open(f"assets/personnages/{nom}.glb", "wb").write(glb)
with open(f"assets/personnages/{nom}.js", "w") as f:
    f.write("/* Généré par outils/preparer-personnage.py (ne pas modifier à la main) */\n")
    f.write("window.MODELES_FUNNELIA = window.MODELES_FUNNELIA || {};\n")
    f.write(f'window.MODELES_FUNNELIA["{nom}"] = "{base64.b64encode(glb).decode()}";\n')
print(f"{nom} : {len(octets) // 1024} Ko -> {len(glb) // 1024} Ko, animations : {[a['name'] for a in gltf['animations']]}")
