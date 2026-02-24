"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Compass,
  Wand2,
  LayoutTemplate,
  Package,
  Settings,
  BookOpen,
  Bot,
} from "lucide-react";

const types = [
  { icon: Compass, title: "Blueprint", anchor: "adwblueprint", description: "Execution constraints and invariants" },
  { icon: Wand2, title: "Skill", anchor: "adwskill", description: "Agent capability definitions" },
  { icon: LayoutTemplate, title: "Template", anchor: "adwtemplate", description: "Repeatable workflow structures" },
  { icon: Package, title: "Artifact", anchor: "adwartifact", description: "Agent-produced outputs" },
  { icon: Settings, title: "Configuration", anchor: "adwconfiguration", description: "Behavior parameterization" },
  { icon: BookOpen, title: "Knowledge", anchor: "core-types", description: "Reference and context documents" },
  { icon: Bot, title: "AgentCard", anchor: "core-types", description: "Agent identity declarations" },
];

export function DocumentTypes() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-12 text-center text-3xl font-bold"
        >
          Document Types
        </motion.h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {types.map((type, i) => (
            <motion.div
              key={type.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <Link
                href={`/spec#${type.anchor}`}
                className="glass glass-hover group flex flex-col gap-2 rounded-xl p-5 transition-all duration-300"
              >
                <type.icon className="size-5 text-violet-400" />
                <h3 className="text-sm font-semibold">{type.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {type.description}
                </p>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
