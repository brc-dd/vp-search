---
title: Vue Page
---

<script setup>
import { data } from './demo.data.ts'

const value = 'scriptvalue8811'
</script>

# Vue Page

## Script Value

The setup block resolves this to {{ value }}.

## Loader Data

The build-time data loader resolves this to {{ data.token }}.

## Slot Text

<Badge type="info">badgeslot8822 sits in a component slot</Badge>

## Client Only

<ClientOnly>clientonly7733 renders only after hydration</ClientOnly>
