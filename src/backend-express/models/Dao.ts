/**
Rôle: Modèle de données (Mongoose/TS) — src/backend-express/models/Dao.ts
Domaine: Backend/Models
Exports: default
Dépendances: mongoose, @shared/dao
Liens: repositories, services (métier)
*/
import mongoose, { Schema } from "mongoose";
import type { Dao, DaoTask, TeamMember } from "@shared/dao";

// TeamMember schema
const TeamMemberSchema = new Schema<TeamMember>({
  id: { type: String, required: true },
  name: { type: String, required: true },
  role: {
    type: String,
    enum: ["chef_equipe", "membre_equipe"],
    required: true,
  },
  email: { type: String },
});

// DaoTask schema
const DaoTaskSchema = new Schema<DaoTask>({
  id: { type: Number, required: true },
  name: { type: String, required: true },
  progress: { type: Number, default: null },
  comment: { type: String },
  isApplicable: { type: Boolean, required: true },
  assignedTo: [{ type: String }],
});

// Main DAO schema
const DaoSchema = new Schema<Dao>(
  {
    id: { type: String, required: true, unique: true },
    numeroListe: { type: String, required: true, unique: true },
    objetDossier: { type: String, required: true },
    reference: { type: String, required: true },
    autoriteContractante: { type: String, required: true },
    dateDepot: { type: String, required: true },
    equipe: [TeamMemberSchema],
    tasks: [DaoTaskSchema],
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  {
    timestamps: false, // We handle timestamps manually
  },
);

// Create and export the model (reuse if already compiled to avoid OverwriteModelError in tests)
const DaoModel =
  (mongoose.models.Dao as mongoose.Model<Dao>) ||
  mongoose.model<Dao>("Dao", DaoSchema);

export default DaoModel;
